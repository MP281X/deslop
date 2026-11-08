import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	Fiber,
	Layer,
	MutableHashMap,
	Option,
	Order,
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
import {KeyValueStore} from 'effect/persistence'

import {REVOKE_PATH, SESSION_COOKIE, TOKEN_PATH, bearerOf, isJwt, rejected} from '#auth/lib/utils.ts'
import type {CodeGrant} from '#auth/schema.ts'
import {AccessClaims, AuthError, TokenResponse, User} from '#auth/schema.ts'

// What this server keeps for one signed-in browser or phone; only Auth can turn its refresh token into access tokens.
type Stored = typeof Stored.Type
const Stored = Schema.Struct({
	access: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	// Written with each refresh, so it trails the last request by at most the access token's lifetime.
	lastUsedAt: Schema.Finite,
	refresh: Schema.RedactedFromValue(Schema.NonEmptyString),
	user: User
})

type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.String, error_description: Schema.optionalKey(Schema.String)})

// Auth turned a code or refresh token down, as opposed to not answering.
class Refused extends Schema.TaggedError<Refused>()('Refused', {message: Schema.String}) {}

// A phone sends its session id as the bearer; a browser holds it in the session cookie.
export function sessionIdOf(headers: Headers.Headers) {
	return Option.orElse(
		Option.filter(bearerOf(headers), token => !isJwt(token)),
		() => Option.fromUndefinedOr(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE])
	)
}

// The sessions this app's server keeps for its own sign-in, each holding the refresh token Auth issued it.
export class Sessions extends Context.Service<
	Sessions,
	{
		// Exchanges a sign-in's code at Auth and keeps the tokens as a new session, answering its id.
		readonly start: (grant: CodeGrant) => Effect.Effect<string, AuthError>
		// Who the session belongs to and an access token with at least a minute left, refreshed at Auth when needed.
		readonly current: (id: string) => Effect.Effect<{token: string; user: User}, AuthError>
		// Ends the sign-in at Auth too; a failed revocation still forgets the session.
		readonly end: (id: string) => Effect.Effect<void, AuthError>
		readonly remember: (token: string, claims: AccessClaims) => Effect.Effect<void>
		readonly tokenFor: (userId: string) => Effect.Effect<string, AuthError>
	}
>()('@deslop/runtime/auth/sessions') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const issuer = yield* Config.option(Config.String('AUTH_URL'))
			const store = KeyValueStore.toSchemaStore(
				KeyValueStore.prefix(yield* KeyValueStore.KeyValueStore, 'session-'),
				Stored
			)
			const digest = yield* Digest.Digest
			const random = yield* SecureRandom.SecureRandom
			const client = yield* HttpClient.HttpClient
			const locks = MutableHashMap.empty<string, Semaphore.Semaphore>()
			const bearers = MutableHashMap.empty<string, {token: string; expiresAt: number}>()
			const app = yield* Config.String('APP_URL')

			// Only a hash of the id is stored, so the store alone cannot act as anyone.
			function keyOf(id: string) {
				return digest.digestHex(Digest.sha256, new TextEncoder().encode(id))
			}

			function lockOf(key: string) {
				return Option.getOrElse(MutableHashMap.get(locks, key), () => {
					const lock = Semaphore.makeUnsafe(1)
					MutableHashMap.set(locks, key, lock)
					return lock
				})
			}

			function fresh(session: Stored) {
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
			const stored = Effect.fnUntraced(function* (tokens: TokenResponse, clientId: string, createdAt: number) {
				const claims = yield* Schema.decodeUnknownEffect(AccessClaims)(
					(yield* Jwt.decodeUnverified(tokens.access_token)).claims
				)
				const now = yield* Clock.currentTimeMillis
				return Stored.make({
					access: tokens.access_token,
					clientId,
					createdAt,
					expiresAt: now + tokens.expires_in * 1000,
					lastUsedAt: now,
					refresh: Redacted.make(tokens.refresh_token),
					user: {id: claims.sub, name: claims.name}
				})
			})

			// A rotated refresh token works once, so a session refreshes once at a time, and the refresh saves its answer even if its caller leaves.
			function refreshed(key: string) {
				return pipe(
					Effect.gen(function* () {
						const session = yield* Effect.fromOption(yield* store.get(key))
						if (yield* fresh(session)) return session
						const tokens = yield* pipe(
							granted({
								client_id: session.clientId,
								grant_type: 'refresh_token',
								refresh_token: Redacted.value(session.refresh)
							}),
							Effect.catchTag('Refused', () =>
								Effect.andThen(store.remove(key), AuthError.make({message: 'Sign in first'}))
							)
						)
						const next = yield* stored(tokens, session.clientId, session.createdAt)
						yield* store.set(key, next)
						return next
					}),
					Semaphore.withPermit(lockOf(key)),
					Effect.forkDetach,
					Effect.flatMap(Fiber.join)
				)
			}

			const tokenFor = Effect.fn('Sessions.tokenFor')(function* (userId: string) {
				const saved = yield* Effect.forEach(
					yield* store.keys,
					key => Effect.map(store.get(key), session => Option.map(session, value => ({key, value}))),
					{concurrency: 'unbounded'}
				)
				const candidates = Array.sort(
					Array.filter(Array.getSomes(saved), session => session.value.user.id === userId),
					Order.mapInput(Order.flip(Order.Number), (session: {key: string; value: Stored}) => session.value.expiresAt)
				)
				for (const session of candidates) {
					if (yield* fresh(session.value)) return session.value.access
					const renewed = yield* Effect.result(
						pipe(refreshed(session.key), rejected('AI access is temporarily unavailable'))
					)
					if (renewed._tag === 'Success') return renewed.success.access
					if (Schema.is(AuthError)(renewed.failure) && renewed.failure.error === 'temporarily_unavailable') {
						return yield* renewed.failure
					}
				}
				const now = yield* Clock.currentTimeMillis
				const bearer = Option.getOrUndefined(
					Option.filter(MutableHashMap.get(bearers, userId), access => access.expiresAt >= now + 60_000)
				)
				if (bearer !== undefined) return bearer.token
				MutableHashMap.remove(bearers, userId)
				return yield* AuthError.make({
					message: `Open ${String.capitalize(String.split(new URL(app).hostname, '.')[0])} once so it can use AI for you`
				})
			}, rejected('AI access is temporarily unavailable'))
			return Sessions.of({
				current: Effect.fn('Sessions.current')(function* (id: string) {
					const key = yield* keyOf(id)
					const saved = yield* Effect.fromOption(yield* store.get(key))
					if (yield* fresh(saved)) return {token: saved.access, user: saved.user}
					const renewed = yield* refreshed(key)
					return {token: renewed.access, user: renewed.user}
				}, rejected('Sign in first')),
				end: Effect.fn('Sessions.end')(function* (id: string) {
					const key = yield* keyOf(id)
					yield* pipe(
						Effect.gen(function* () {
							for (const session of Option.toArray(yield* store.get(key))) {
								yield* pipe(
									post(REVOKE_PATH, {client_id: session.clientId, token: Redacted.value(session.refresh)}),
									Effect.flatMap(HttpClientResponse.filterStatusOk),
									Effect.ignore({log: 'Warn', message: 'Auth did not revoke the sign-in'})
								)
							}
							yield* store.remove(key)
						}),
						Semaphore.withPermit(lockOf(key))
					)
				}, rejected('The session could not be ended')),
				remember: (token, claims) =>
					Effect.sync(() => {
						MutableHashMap.set(bearers, claims.sub, {expiresAt: claims.exp * 1000, token})
					}),
				start: Effect.fn('Sessions.start')(function* (grant: CodeGrant) {
					const tokens = yield* pipe(
						granted({...grant, grant_type: 'authorization_code'}),
						Effect.catchTag('Refused', refusal => AuthError.make({message: refusal.message}))
					)
					const id = Base64Url.encode(yield* random.randomBytes(32))
					yield* store.set(yield* keyOf(id), yield* stored(tokens, grant.client_id, yield* Clock.currentTimeMillis))
					return id
				}, rejected('The sign-in could not be completed')),
				tokenFor
			})
		})
	)
}
