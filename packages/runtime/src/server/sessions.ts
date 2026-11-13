import {
	Clock,
	Config,
	Context,
	Effect,
	Fiber,
	Layer,
	MutableHashMap,
	Option,
	Redacted,
	Schema,
	Semaphore,
	String,
	pipe
} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import type {Headers} from 'effect/http'
import {Cookies, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Jwt} from 'effect/jose'
import {Model} from 'effect/schema'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {
	AccessClaims,
	AuthError,
	REFRESH_SECONDS,
	REVOKE_PATH,
	SESSION_COOKIE,
	TOKEN_PATH,
	TokenResponse,
	User,
	bearerOf,
	isJwt,
	rejected
} from '#shared/auth.ts'
import type {CodeGrant} from '#shared/auth.ts'

class Session extends Model.Class<Session>('Session')({
	access: Model.Sensitive(Schema.RedactedFromValue(Schema.NonEmptyString)),
	clientId: Schema.NonEmptyString,
	// When the access token expires.
	expiresAt: Schema.Int,
	// Only a hash of the session's id, so the table alone cannot act as anyone.
	idHash: Schema.NonEmptyString,
	refresh: Model.Sensitive(Schema.RedactedFromValue(Schema.NonEmptyString)),
	// When Auth issued the refresh token, which lasts REFRESH_SECONDS from then.
	refreshedAt: Schema.Int,
	userId: User.fields.id,
	userName: User.fields.name
}) {
	static readonly table = 'sessions'
}

type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.String, error_description: Schema.optionalKey(Schema.String)})

class Refused extends Schema.TaggedError<Refused>()('Refused', {message: Schema.String}) {}

export function sessionIdOf(headers: Headers.Headers) {
	return Option.orElse(
		Option.filter(bearerOf(headers), token => !isJwt(token)),
		() => Option.fromUndefinedOr(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE])
	)
}

export class Sessions extends Context.Service<
	Sessions,
	{
		readonly start: (grant: CodeGrant) => Effect.Effect<string, AuthError>
		readonly current: (id: string) => Effect.Effect<{token: string; user: User}, AuthError>
		// Ends the sign-in at Auth too; a failed revocation still forgets the session.
		readonly end: (id: string) => Effect.Effect<void, AuthError>
		readonly remember: (token: string, claims: AccessClaims) => Effect.Effect<void>
		readonly tokenFor: (userId: string) => Effect.Effect<string, AuthError>
	}
>()('@deslop/runtime/server/sessions') {
	static readonly model = Session

	// The table every app's database holds for its sign-ins, made at start; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_sessions': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE sessions (
							idHash TEXT PRIMARY KEY,
							clientId TEXT NOT NULL,
							userId TEXT NOT NULL,
							userName TEXT NOT NULL,
							access TEXT NOT NULL,
							refresh TEXT NOT NULL,
							expiresAt INTEGER NOT NULL,
							refreshedAt INTEGER NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX sessions_by_user ON sessions (userId, expiresAt)`
				})
			}),
			table: 'sessions_migrations'
		})
	)

	static readonly layer = Layer.provide(
		Layer.effect(
			this,
			Effect.gen(function* () {
				const issuer = yield* Config.option(Config.String('AUTH_URL'))
				const sql = yield* SqlClient.SqlClient
				const digest = yield* Digest.Digest
				const random = yield* SecureRandom.SecureRandom
				const client = yield* HttpClient.HttpClient
				const locks = MutableHashMap.empty<string, Semaphore.Semaphore>()
				const bearers = MutableHashMap.empty<string, {token: Redacted.Redacted; expiresAt: number}>()
				const app = yield* Config.String('APP_URL')

				const findSession = SqlSchema.findOneOption({
					Request: Session.fields.idHash,
					Result: Session,
					execute: idHash => sql`SELECT * FROM ${sql(Session.table)} WHERE idHash = ${idHash}`
				})
				const findSessionsOf = SqlSchema.findAll({
					Request: Session.fields.userId,
					Result: Session,
					execute: userId => sql`SELECT * FROM ${sql(Session.table)} WHERE userId = ${userId} ORDER BY expiresAt DESC`
				})
				// A refresh replaces the session's tokens under the same hash.
				const saveSession = SqlSchema.void({
					Request: Session.insert,
					execute: row => sql`INSERT OR REPLACE INTO ${sql(Session.table)} ${sql.insert(row)}`
				})
				const deleteSession = SqlSchema.void({
					Request: Session.fields.idHash,
					execute: idHash => sql`DELETE FROM ${sql(Session.table)} WHERE idHash = ${idHash}`
				})
				const deleteSessionsBefore = SqlSchema.void({
					Request: Session.fields.refreshedAt,
					execute: refreshedAt => sql`DELETE FROM ${sql(Session.table)} WHERE refreshedAt < ${refreshedAt}`
				})

				function idHashOf(id: string) {
					return digest.digestHex(Digest.sha256, new TextEncoder().encode(id))
				}

				function lockOf(idHash: string) {
					return Option.getOrElse(MutableHashMap.get(locks, idHash), () => {
						const lock = Semaphore.makeUnsafe(1)
						MutableHashMap.set(locks, idHash, lock)
						return lock
					})
				}

				function fresh(session: Session) {
					return Effect.map(Clock.currentTimeMillis, now => session.expiresAt > now + 60_000)
				}

				const post = Effect.fnUntraced(function* (path: string, params: Record<string, string>) {
					return yield* pipe(
						client.execute(
							HttpClientRequest.bodyUrlParams(
								HttpClientRequest.post(new URL(path, yield* Effect.fromOption(issuer)).href),
								params
							)
						),
						Effect.timeout('10 seconds')
					)
				})

				// Auth refuses a code or refresh token with 400 or 401 and says why; any other failure is an outage.
				const granted = Effect.fnUntraced(function* (params: Record<string, string>) {
					const response = yield* post(TOKEN_PATH, params)
					if (response.status === 400 || response.status === 401) {
						return yield* Refused.make({
							message: Option.getOrElse(
								Option.flatMap(yield* Effect.option(HttpClientResponse.schemaBodyJson(Refusal)(response)), body =>
									Option.fromUndefinedOr(body.error_description)
								),
								() => 'Auth refused the sign-in'
							)
						})
					}
					return yield* HttpClientResponse.schemaBodyJson(TokenResponse)(
						yield* HttpClientResponse.filterStatusOk(response)
					)
				})

				// The claims come straight from Auth over TLS, so they need no signature check here.
				const sessionOf = Effect.fnUntraced(function* (tokens: TokenResponse, clientId: string, idHash: string) {
					const claims = yield* Schema.decodeUnknownEffect(AccessClaims)(
						(yield* Jwt.decodeUnverified(tokens.access_token)).claims
					)
					return Session.make({
						access: Redacted.make(tokens.access_token),
						clientId,
						expiresAt: claims.exp * 1000,
						idHash,
						refresh: Redacted.make(tokens.refresh_token),
						refreshedAt: yield* Clock.currentTimeMillis,
						userId: claims.sub,
						userName: claims.name
					})
				})

				// A rotated refresh token works once, so a session refreshes once at a time, and the refresh saves its answer even if its caller leaves.
				function refreshed(idHash: string) {
					return pipe(
						Effect.gen(function* () {
							const session = yield* Effect.fromOption(yield* findSession(idHash))
							if (yield* fresh(session)) return session
							const tokens = yield* pipe(
								granted({
									client_id: session.clientId,
									grant_type: 'refresh_token',
									refresh_token: Redacted.value(session.refresh)
								}),
								Effect.catchTag('Refused', () =>
									Effect.andThen(deleteSession(idHash), AuthError.make({message: 'Sign in first'}))
								)
							)
							const next = yield* sessionOf(tokens, session.clientId, idHash)
							yield* saveSession(next)
							return next
						}),
						Semaphore.withPermit(lockOf(idHash)),
						Effect.forkDetach,
						Effect.flatMap(Fiber.join)
					)
				}

				return Sessions.of({
					current: Effect.fn('Sessions.current')(function* (id: string) {
						const idHash = yield* idHashOf(id)
						const saved = yield* Effect.fromOption(yield* findSession(idHash))
						if (yield* fresh(saved)) {
							return {token: Redacted.value(saved.access), user: {id: saved.userId, name: saved.userName}}
						}
						const renewed = yield* refreshed(idHash)
						return {token: Redacted.value(renewed.access), user: {id: renewed.userId, name: renewed.userName}}
					}, rejected('Sign in first')),
					end: Effect.fn('Sessions.end')(function* (id: string) {
						const idHash = yield* idHashOf(id)
						yield* pipe(
							Effect.gen(function* () {
								for (const session of Option.toArray(yield* findSession(idHash))) {
									yield* pipe(
										post(REVOKE_PATH, {client_id: session.clientId, token: Redacted.value(session.refresh)}),
										Effect.flatMap(HttpClientResponse.filterStatusOk),
										Effect.ignore({log: 'Warn', message: 'Auth did not revoke the sign-in'})
									)
								}
								yield* deleteSession(idHash)
							}),
							Semaphore.withPermit(lockOf(idHash))
						)
					}, rejected('The session could not be ended')),
					remember: (token, claims) =>
						Effect.sync(() => {
							MutableHashMap.set(bearers, claims.sub, {expiresAt: claims.exp * 1000, token: Redacted.make(token)})
						}),
					// A new sign-in also drops the sessions whose refresh token Auth no longer accepts.
					start: Effect.fn('Sessions.start')(function* (grant: CodeGrant) {
						const tokens = yield* pipe(
							granted({...grant, grant_type: 'authorization_code'}),
							Effect.catchTag('Refused', refusal => AuthError.make({message: refusal.message}))
						)
						const id = Base64Url.encode(yield* random.randomBytes(32))
						const session = yield* sessionOf(tokens, grant.client_id, yield* idHashOf(id))
						yield* pipe(
							Effect.andThen(deleteSessionsBefore(session.refreshedAt - REFRESH_SECONDS * 1000), saveSession(session)),
							sql.withTransaction
						)
						return id
					}, rejected('The sign-in could not be completed')),
					// The person's session whose access token lasts longest, refreshed if it must be; else the bearer they last called with.
					tokenFor: Effect.fn('Sessions.tokenFor')(function* (userId: string) {
						for (const session of yield* findSessionsOf(userId)) {
							if (yield* fresh(session)) return Redacted.value(session.access)
							const renewed = yield* Effect.result(
								pipe(refreshed(session.idHash), rejected('AI access is temporarily unavailable'))
							)
							if (renewed._tag === 'Success') return Redacted.value(renewed.success.access)
							if (Schema.is(AuthError)(renewed.failure) && renewed.failure.error === 'temporarily_unavailable') {
								return yield* renewed.failure
							}
						}
						const now = yield* Clock.currentTimeMillis
						const bearer = Option.getOrUndefined(
							Option.filter(MutableHashMap.get(bearers, userId), access => access.expiresAt >= now + 60_000)
						)
						if (bearer !== undefined) return Redacted.value(bearer.token)
						MutableHashMap.remove(bearers, userId)
						return yield* AuthError.make({
							message: `Open ${String.capitalize(String.split(new URL(app).hostname, '.')[0])} once so it can use AI for you`
						})
					}, rejected('AI access is temporarily unavailable'))
				})
			})
		),
		Sessions.migrations
	)
}
