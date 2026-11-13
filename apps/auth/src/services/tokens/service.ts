import {
	Array,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	HashMap,
	Layer,
	Match,
	Option,
	Redacted,
	Ref,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest, SecureRandom, Signature} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import type {Jwks} from 'effect/jose'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {
	ACCESS_LIFETIME,
	AccessClaims,
	AuthError,
	ISSUER_PATH,
	REFRESH_LIFETIME,
	SignInFamily,
	bearerOf,
	asAuthError
} from '@deslop/runtime/shared/auth'

import {
	browserLabel,
	browserToken,
	clientLabel,
	clientOf,
	credentialOwnerOf,
	deviceLabel,
	given,
	hashOf,
	matchingRedirect,
	randomTokenOf,
	sameOwner
} from '#services/tokens/lib/utils.ts'
import type {
	AuthorizeClient,
	ClientRequest,
	DeviceRequest,
	Origin,
	RevokeParams,
	SessionVia,
	TokenParams,
	TokenResponse
} from '#services/tokens/schema.ts'
import {
	AppGrant,
	BrowserSession,
	CredentialOwner,
	Exchange,
	OwnedSignIns,
	SignInLookup,
	SignedInApp,
	SigningKey,
	SpentRefreshToken,
	TokenParts
} from '#services/tokens/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly tokens: never
	}
}

// An authorization code lives 60 seconds in memory; once redeemed it names the family it gave, so a replay ends it.
type Code = {
	expiresAt: DateTime.Utc
	state: {_tag: 'Fresh'; request: ClientRequest; owner: CredentialOwner} | {_tag: 'Used'; family: SignInFamily}
}

const expired = AuthError.make({error: 'invalid_grant', message: 'The authorization expired. Sign in again.'})

// A token is its grant's family, a dot and its secret; a refresh token also names its generation.
function parts(token: string) {
	return Option.flatMap(
		String.match(/^(?<family>[\w-]{16,64})\.(?:(?<generation>\d{1,9})\.)?(?<secret>[\w-]{16,64})$/u)(token),
		found => Schema.decodeUnknownOption(TokenParts)(found.groups)
	)
}

// Signed-in apps and browsers live in Auth's database; codes and sign-ins in progress stay in memory.
export class Tokens extends Context.Service<
	Tokens,
	{
		readonly watchApps: (owner: CredentialOwner) => Stream.Stream<readonly SignedInApp[], AuthError>
		readonly client: (asked: AuthorizeClient) => Effect.Effect<{clientName: string; redirectUri: string}, AuthError>
		readonly device: (
			request: DeviceRequest,
			owner: CredentialOwner,
			origin: Origin
		) => Effect.Effect<TokenResponse, AuthError>
		readonly disconnect: (family: SignInFamily, owner: CredentialOwner) => Effect.Effect<void, AuthError>
		readonly endSession: (headers: Headers.Headers) => Effect.Effect<void, AuthError>
		// Tokens go only to an account `allowed` still accepts, so a removal between approval and exchange takes effect.
		readonly exchange: (
			params: TokenParams,
			origin: Origin,
			allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
		) => Effect.Effect<Exchange, AuthError>
		readonly forget: (owner: CredentialOwner) => Effect.Effect<void, AuthError>
		readonly issue: (request: ClientRequest, owner: CredentialOwner) => Effect.Effect<string, AuthError>
		readonly issuer: string
		readonly jwks: Jwks.KeySet
		readonly revoke: (params: RevokeParams) => Effect.Effect<void, AuthError>
		readonly session: (headers: Headers.Headers) => Effect.Effect<CredentialOwner, AuthError>
		readonly sessionVia: (headers: Headers.Headers) => Effect.Effect<SessionVia, AuthError>
		readonly browserSession: (
			headers: Headers.Headers
		) => Effect.Effect<{family: SignInFamily; owner: CredentialOwner; via: SessionVia}, AuthError>
		readonly startSession: (
			owner: CredentialOwner,
			origin: Origin,
			via: SessionVia,
			previous: Option.Option<string>
		) => Effect.Effect<{seconds: Duration.Duration; token: string}, AuthError>
		readonly verify: (headers: Headers.Headers) => Effect.Effect<CredentialOwner, AuthError>
	}
>()('@deslop/auth/services/tokens/service/Tokens') {
	// The tables this service owns, made at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				// fallow-ignore-next-line code-duplication -- Numbered migrations describe independent app tables; SQL declaration shape is not shared migration logic.
				'0001_tokens': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE browser_sessions (
							family TEXT PRIMARY KEY,
							userId TEXT NOT NULL,
							userName TEXT NOT NULL,
							incarnation TEXT NOT NULL,
							client TEXT NOT NULL,
							device TEXT NOT NULL,
							address TEXT,
							via TEXT NOT NULL,
							hash TEXT NOT NULL,
							expiresAt INTEGER NOT NULL,
							lastActive INTEGER NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX browser_sessions_by_owner ON browser_sessions (userId, incarnation)`
					yield* sql`CREATE INDEX browser_sessions_by_expiry ON browser_sessions (expiresAt)`
					// A web app's sign-in cannot outlive the browser session it came from.
					yield* sql`
						CREATE TABLE app_grants (
							family TEXT PRIMARY KEY,
							userId TEXT NOT NULL,
							userName TEXT NOT NULL,
							incarnation TEXT NOT NULL,
							client TEXT NOT NULL,
							device TEXT NOT NULL,
							address TEXT,
							clientId TEXT NOT NULL,
							parent TEXT REFERENCES browser_sessions (family) ON DELETE CASCADE,
							generation INTEGER NOT NULL,
							hash TEXT NOT NULL,
							expiresAt INTEGER NOT NULL,
							lastActive INTEGER NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX app_grants_by_owner ON app_grants (userId, incarnation)`
					yield* sql`CREATE INDEX app_grants_by_parent ON app_grants (parent)`
					yield* sql`CREATE INDEX app_grants_by_expiry ON app_grants (expiresAt)`
					yield* sql`
						CREATE TABLE spent_refresh_tokens (
							family TEXT NOT NULL REFERENCES app_grants (family) ON DELETE CASCADE,
							hash TEXT NOT NULL,
							PRIMARY KEY (family, hash)
						) STRICT, WITHOUT ROWID
					`
					yield* sql`CREATE TABLE signing_keys (privateJwk TEXT NOT NULL) STRICT`
				})
			}),
			table: 'tokens_migrations'
		})
	)

	static readonly layer = Layer.provide(
		Layer.effect(
			Tokens,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)

				// An app grant is live until it expires, and a web app's only while its browser session is.
				function liveGrant(now: number) {
					return sql`expiresAt > ${now} AND (parent IS NULL OR parent IN (
						SELECT family FROM ${sql(BrowserSession.table)} WHERE expiresAt > ${now}
					))`
				}
				const findSession = SqlSchema.findOneOption({
					Request: SignInLookup,
					Result: BrowserSession,
					execute: request => sql`
						SELECT * FROM ${sql(BrowserSession.table)} WHERE family = ${request.family} AND expiresAt > ${request.now}
					`
				})
				const findGrant = SqlSchema.findOneOption({
					Request: SignInLookup,
					Result: AppGrant,
					execute: request => sql`
						SELECT * FROM ${sql(AppGrant.table)} WHERE family = ${request.family} AND ${liveGrant(request.now)}
					`
				})
				// The account's live browser sessions and app grants, most recently active first.
				const listSignedIn = SqlSchema.findAll({
					Request: OwnedSignIns,
					Result: SignedInApp,
					execute: request => sql`
						SELECT family, client, device, address, lastActive, NULL AS parent, 'Browser' AS kind
						FROM ${sql(BrowserSession.table)}
						WHERE userId = ${request.owner.user.id} AND incarnation = ${request.owner.incarnation}
							AND expiresAt > ${request.now}
						UNION ALL
						SELECT family, client, device, address, lastActive, parent, 'App' AS kind
						FROM ${sql(AppGrant.table)}
						WHERE userId = ${request.owner.user.id} AND incarnation = ${request.owner.incarnation}
							AND ${liveGrant(request.now)}
						ORDER BY lastActive DESC
					`
				})
				const isSpent = SqlSchema.findOneOption({
					Request: SpentRefreshToken.insert,
					Result: Schema.Struct({family: SpentRefreshToken.fields.family}),
					execute: spent => sql`
						SELECT family FROM ${sql(SpentRefreshToken.table)} WHERE family = ${spent.family} AND hash = ${spent.hash}
					`
				})
				const insertSession = SqlSchema.void({
					Request: BrowserSession.insert,
					execute: row => sql`INSERT INTO ${sql(BrowserSession.table)} ${sql.insert(row)}`
				})
				const insertGrant = SqlSchema.void({
					Request: AppGrant.insert,
					execute: row => sql`INSERT INTO ${sql(AppGrant.table)} ${sql.insert(row)}`
				})
				const insertSpent = SqlSchema.void({
					Request: SpentRefreshToken.insert,
					execute: row => sql`INSERT INTO ${sql(SpentRefreshToken.table)} ${sql.insert(row)}`
				})
				// A refresh moves the grant to its next generation and secret, and labels it by where the refresh came from.
				const rotateGrant = SqlSchema.void({
					Request: Schema.Struct(
						Struct.pick(AppGrant.update.fields, [
							'address',
							'device',
							'expiresAt',
							'family',
							'generation',
							'hash',
							'lastActive'
						])
					),
					execute: row => sql`
						UPDATE ${sql(AppGrant.table)} SET ${sql.update(row, ['family'])} WHERE family = ${row.family}
					`
				})
				// Touch a grant at most once a minute, so a token's last use shows without a write per tool call.
				const touchGrant = SqlSchema.void({
					Request: Schema.Struct({...SignInLookup.fields, before: Schema.DateTimeUtcFromMillis}),
					execute: request => sql`
						UPDATE ${sql(AppGrant.table)} SET lastActive = ${request.now}
						WHERE family = ${request.family} AND lastActive < ${request.before}
					`
				})
				// Ending a browser session ends the web app sign-ins it started.
				const deleteFamily = SqlSchema.void({
					Request: SignInFamily,
					execute: family =>
						Effect.andThen(
							sql`DELETE FROM ${sql(BrowserSession.table)} WHERE family = ${family}`,
							sql`DELETE FROM ${sql(AppGrant.table)} WHERE family = ${family}`
						)
				})
				const deleteOwned = SqlSchema.void({
					Request: CredentialOwner,
					execute: owner =>
						Effect.andThen(
							sql`
								DELETE FROM ${sql(BrowserSession.table)}
								WHERE userId = ${owner.user.id} AND incarnation = ${owner.incarnation}
							`,
							sql`
								DELETE FROM ${sql(AppGrant.table)} WHERE userId = ${owner.user.id} AND incarnation = ${owner.incarnation}
							`
						)
				})
				// Expired sign-ins leave the tables whenever a new one is made, so they never pile up.
				const deleteExpired = SqlSchema.void({
					Request: Schema.DateTimeUtcFromMillis,
					execute: now =>
						Effect.andThen(
							sql`DELETE FROM ${sql(BrowserSession.table)} WHERE expiresAt <= ${now}`,
							sql`DELETE FROM ${sql(AppGrant.table)} WHERE expiresAt <= ${now}`
						)
				})
				// A new sign-in of the same app on the same device replaces the last one.
				const deleteSameApp = SqlSchema.void({
					Request: AppGrant.insert,
					execute: grant => sql`
						DELETE FROM ${sql(AppGrant.table)}
						WHERE userId = ${grant.userId} AND incarnation = ${grant.incarnation} AND client = ${grant.client}
							AND device = ${grant.device} AND parent IS ${grant.parent}
					`
				})
				// RFC 7009: only the client's own live refresh token ends its sign-in.
				const deleteRevoked = SqlSchema.void({
					Request: Schema.Struct({clientId: AppGrant.fields.clientId, family: SignInFamily, hash: Schema.String}),
					execute: request => sql`
						DELETE FROM ${sql(AppGrant.table)}
						WHERE family = ${request.family} AND clientId = ${request.clientId} AND hash = ${request.hash}
					`
				})
				const findSigningKey = SqlSchema.findOneOption({
					Request: Schema.Void,
					Result: SigningKey,
					execute: () => sql`SELECT * FROM ${sql(SigningKey.table)} LIMIT 1`
				})
				const insertSigningKey = SqlSchema.void({
					Request: SigningKey.insert,
					execute: row => sql`INSERT INTO ${sql(SigningKey.table)} ${sql.insert(row)}`
				})

				const issuer = `${new URL(yield* Config.String('APP_URL')).origin}${ISSUER_PATH}`
				const privateJwk = yield* Option.match(yield* findSigningKey(), {
					onNone: () =>
						pipe(
							Jwk.generateKeyPair({algorithm: 'EdDSA'}),
							Effect.flatMap(pair => Jwk.importPrivate(pair.privateKey, 'EdDSA')),
							Effect.flatMap(Jwk.exportPrivate),
							Effect.tap(key => insertSigningKey({privateJwk: key}))
						),
					onSome: row => Effect.succeed(row.privateJwk)
				})
				const privateKey = yield* Jwk.importPrivate(privateJwk, 'EdDSA')
				const kid = yield* Jwk.thumbprint(privateJwk)
				const publicJwk = yield* Schema.decodeUnknownEffect(Jwk.PublicJwk)({
					...Struct.omit(Redacted.value(privateJwk), ['d', 'key_ops']),
					alg: 'EdDSA',
					kid,
					use: 'sig'
				})
				const publicKey = yield* Jwk.importPublic(publicJwk, 'EdDSA')
				const signature = yield* Signature.Signature
				const codes = yield* Ref.make(HashMap.empty<string, Code>())
				const redeeming = yield* Semaphore.make(1)
				const randomToken = randomTokenOf(yield* SecureRandom.SecureRandom)
				const hash = hashOf(yield* Digest.Digest)
				const browser = Effect.fn('Tokens.browserSession')(function* (headers: Headers.Headers) {
					const found = yield* pipe(browserToken(headers), Option.flatMap(parts), Effect.fromOption)
					const session = yield* Effect.flatMap(
						findSession({family: found.family, now: yield* DateTime.now}),
						Effect.fromOption
					)
					if (session.hash !== (yield* hash(found.secret))) return yield* AuthError.make({message: 'Sign in first'})
					return {family: session.family, owner: credentialOwnerOf(session), via: session.via}
				}, asAuthError('Sign in first'))
				const session = Effect.fn('Tokens.session')(function* (headers: Headers.Headers) {
					return (yield* browser(headers)).owner
				})
				const sessionVia = Effect.fn('Tokens.sessionVia')(function* (headers: Headers.Headers) {
					return (yield* browser(headers)).via
				})
				const verify = Effect.fn('Tokens.verify')(
					function* (headers: Headers.Headers) {
						const verified = yield* Effect.provideService(
							Jwt.verify(AccessClaims, yield* Effect.fromOption(bearerOf(headers)), publicKey, {
								audience: 'deslop',
								issuer,
								typ: 'at+jwt'
							}),
							Signature.Signature,
							signature
						)
						const now = yield* DateTime.now
						const grant = yield* Effect.flatMap(findGrant({family: verified.claims.sid, now}), Effect.fromOption)
						if (grant.userId !== verified.claims.sub) return yield* AuthError.make({message: 'Sign in first'})
						if (DateTime.isGreaterThan(now, DateTime.addDuration(grant.lastActive, Duration.minutes(1)))) {
							yield* pipe(
								touchGrant({before: DateTime.subtractDuration(now, Duration.minutes(1)), family: grant.family, now}),
								Reactivity.mutation(['tokens']),
								Effect.ignore({log: 'Warn', message: 'The token’s last use could not be saved'})
							)
						}
						return credentialOwnerOf(grant)
					},
					withReactivity,
					asAuthError('Sign in first')
				)
				const mint = Effect.fnUntraced(function* (
					family: SignInFamily,
					generation: number,
					owner: CredentialOwner,
					client: string,
					now: DateTime.Utc
				) {
					const refreshSecret = yield* randomToken(32)
					const iat = DateTime.startOf(now, 'second')
					const access = yield* Effect.provideService(
						Jwt.sign(
							AccessClaims,
							{
								aud: 'deslop',
								azp: client,
								exp: DateTime.addDuration(iat, ACCESS_LIFETIME),
								iat,
								iss: issuer,
								name: owner.user.name,
								sid: family,
								sub: owner.user.id
							},
							privateKey,
							{kid, typ: 'at+jwt'}
						),
						Signature.Signature,
						signature
					)
					return {
						refresh: {expiresAt: DateTime.addDuration(now, REFRESH_LIFETIME), hash: yield* hash(refreshSecret)},
						tokens: {
							access_token: Redacted.value(access),
							expires_in: ACCESS_LIFETIME,
							refresh_token: `${family}.${generation}.${refreshSecret}`,
							scope: 'deslop' as const,
							token_type: 'Bearer' as const
						}
					}
				})
				// A new app sign-in, written inside the caller's transaction.
				const signIn = Effect.fnUntraced(function* (
					now: DateTime.Utc,
					family: SignInFamily,
					request: DeviceRequest & {parent: Option.Option<SignInFamily>},
					owner: CredentialOwner,
					origin: Origin
				) {
					const minted = yield* asAuthError('Cannot sign the access token')(
						mint(family, 0, owner, clientLabel(request.clientName), now)
					)
					const grant = {
						address: origin.address,
						client: clientLabel(request.clientName),
						clientId: request.clientId,
						device: deviceLabel(origin),
						family,
						generation: 0,
						incarnation: owner.incarnation,
						lastActive: now,
						parent: request.parent,
						userId: owner.user.id,
						userName: owner.user.name,
						...minted.refresh
					}
					yield* deleteExpired(now)
					yield* deleteSameApp(grant)
					yield* insertGrant(grant)
					return minted.tokens
				})
				const redeem = Effect.fnUntraced(
					function* (
						params: Extract<TokenParams, {grant_type: 'authorization_code'}>,
						origin: Origin,
						allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
					) {
						const key = yield* hash(params.code)
						const verifier = yield* hash(params.code_verifier)
						const family = SignInFamily.make(yield* randomToken(16))
						// The grant commits before its code is marked used; concurrent redemptions take turns through both steps.
						const result = yield* pipe(
							Effect.gen(function* () {
								const now = yield* DateTime.now
								const code = yield* pipe(
									HashMap.get(yield* Ref.get(codes), key),
									Option.filter(entry => DateTime.isGreaterThan(entry.expiresAt, now)),
									Effect.fromOption,
									Effect.mapError(() => expired)
								)
								if (code.state._tag === 'Used') {
									yield* deleteFamily(code.state.family)
									return Exchange.cases.Replayed.make({
										message:
											'This authorization code was already used, so the tokens it gave are revoked; sign in again'
									})
								}
								const fresh = code.state
								if (
									fresh.request.clientId !== params.client_id ||
									Option.exists(given(params.redirect_uri), sent => sent !== fresh.request.redirectUri) ||
									fresh.request.challenge !== verifier
								) {
									return yield* AuthError.make({
										error: 'invalid_grant',
										message: 'The authorization code, its client, callback or verifier do not match'
									})
								}
								yield* allowed(fresh.owner)
								yield* Option.match(fresh.request.parent, {
									onNone: () => Effect.void,
									onSome: Effect.fnUntraced(function* (parent) {
										if (
											!Option.exists(yield* findSession({family: parent, now}), found =>
												sameOwner(credentialOwnerOf(found), fresh.owner)
											)
										) {
											return yield* expired
										}
									})
								})
								return Exchange.cases.Granted.make({
									tokens: yield* signIn(now, family, fresh.request, fresh.owner, origin)
								})
							}),
							Reactivity.mutation(['tokens']),
							sql.withTransaction
						)
						if (result._tag === 'Granted') {
							yield* Ref.update(codes, entries =>
								HashMap.modify(entries, key, code => ({
									expiresAt: code.expiresAt,
									state: {_tag: 'Used' as const, family}
								}))
							)
						}
						return result
					},
					Effect.uninterruptible,
					Semaphore.withPermit(redeeming)
				)
				const rotate = Effect.fnUntraced(function* (
					params: Extract<TokenParams, {grant_type: 'refresh_token'}>,
					origin: Origin,
					allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
				) {
					const presented = yield* pipe(
						parts(params.refresh_token),
						Effect.fromOption,
						Effect.mapError(() => expired)
					)
					const presentedHash = yield* hash(presented.secret)
					return yield* pipe(
						Effect.gen(function* () {
							const now = yield* DateTime.now
							const grant = yield* Effect.flatMap(
								findGrant({family: presented.family, now}),
								Option.match({onNone: () => Effect.fail(expired), onSome: Effect.succeed})
							)
							if (Option.exists(given(params.client_id), sent => sent !== grant.clientId)) {
								return yield* AuthError.make({
									error: 'invalid_grant',
									message: 'The refresh token belongs to another client'
								})
							}
							// Only a spent token's secret proves a replay; a guess at the family ends nothing.
							if (
								Option.match(presented.generation, {
									onNone: () => true,
									onSome: generation => generation < grant.generation
								}) &&
								Option.isSome(yield* isSpent({family: grant.family, hash: presentedHash}))
							) {
								yield* deleteFamily(grant.family)
								return Exchange.cases.Replayed.make({
									message: 'This refresh token was already used, so its sign-in is revoked; sign in again'
								})
							}
							if (!Option.contains(presented.generation, grant.generation) || presentedHash !== grant.hash) {
								return yield* expired
							}
							const owner = credentialOwnerOf(grant)
							yield* allowed(owner)
							const minted = yield* asAuthError('Cannot sign the access token')(
								mint(grant.family, grant.generation + 1, owner, grant.client, now)
							)
							yield* insertSpent({family: grant.family, hash: grant.hash})
							yield* rotateGrant({
								// Recomputed, so a sign-in labelled by an older rule takes the current one on its next refresh.
								address: origin.address,
								device: deviceLabel(origin),
								family: grant.family,
								generation: grant.generation + 1,
								lastActive: now,
								...minted.refresh
							})
							return Exchange.cases.Granted.make({tokens: minted.tokens})
						}),
						Reactivity.mutation(['tokens']),
						sql.withTransaction
					)
				})
				const listApps = Effect.fnUntraced(function* (owner: CredentialOwner) {
					return yield* listSignedIn({now: yield* DateTime.now, owner})
				}, asAuthError('Cannot read the sign-ins'))

				return Tokens.of({
					browserSession: browser,
					client: Effect.fn('Tokens.client')(function* (asked: AuthorizeClient) {
						const client = yield* pipe(
							clientOf(asked.client_id),
							Effect.fromOption,
							Effect.mapError(() =>
								AuthError.make({
									error: 'invalid_client',
									message: 'This client is not registered; start the sign-in again in the app'
								})
							)
						)
						const redirectUri = yield* pipe(
							matchingRedirect(client, given(asked.redirect_uri)),
							Effect.fromOption,
							Effect.mapError(cause =>
								AuthError.make({cause, message: 'The callback does not match the registered client'})
							)
						)
						return {clientName: client.name, redirectUri}
					}),
					device: Effect.fn('Tokens.device')(
						function* (request: DeviceRequest, owner: CredentialOwner, origin: Origin) {
							const family = SignInFamily.make(yield* randomToken(16))
							return yield* pipe(
								Effect.flatMap(DateTime.now, now =>
									signIn(now, family, {...request, parent: Option.none()}, owner, origin)
								),
								Reactivity.mutation(['tokens']),
								sql.withTransaction
							)
						},
						withReactivity,
						asAuthError('Cannot sign the command in')
					),
					disconnect: Effect.fn('Tokens.disconnect')(
						function* (family: SignInFamily, owner: CredentialOwner) {
							yield* pipe(
								Effect.gen(function* () {
									const now = yield* DateTime.now
									const signedIn = [
										...Option.toArray(yield* findSession({family, now})),
										...Option.toArray(yield* findGrant({family, now}))
									]
									if (!Array.some(signedIn, row => sameOwner(credentialOwnerOf(row), owner))) {
										return yield* AuthError.make({message: 'This sign-in has already ended'})
									}
									yield* deleteFamily(family)
								}),
								Reactivity.mutation(['tokens']),
								sql.withTransaction
							)
						},
						withReactivity,
						asAuthError('Cannot sign this out')
					),
					endSession: Effect.fn('Tokens.endSession')(
						function* (headers: Headers.Headers) {
							yield* Option.match(yield* Effect.option(browser(headers)), {
								onNone: () => Effect.void,
								onSome: own => pipe(deleteFamily(own.family), Reactivity.mutation(['tokens']), sql.withTransaction)
							})
						},
						withReactivity,
						asAuthError('Cannot sign out')
					),
					exchange: Effect.fn('Tokens.exchange')(
						function* (
							params: TokenParams,
							origin: Origin,
							allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
						) {
							if (params.grant_type === 'authorization_code') return yield* redeem(params, origin, allowed)
							return yield* rotate(params, origin, allowed)
						},
						withReactivity,
						asAuthError('Invalid token request')
					),
					// Removing an account signs it out everywhere; a sign-in it approved but not yet delivered checks the account at delivery.
					forget: Effect.fn('Tokens.forget')(
						function* (owner: CredentialOwner) {
							yield* pipe(deleteOwned(owner), Reactivity.mutation(['tokens']), sql.withTransaction)
							yield* Ref.update(
								codes,
								HashMap.filter(entry => entry.state._tag === 'Used' || !sameOwner(entry.state.owner, owner))
							)
						},
						withReactivity,
						asAuthError('Cannot sign this account out')
					),
					issue: Effect.fn('Tokens.issue')(function* (request: ClientRequest, owner: CredentialOwner) {
						const code = yield* randomToken(32)
						const key = yield* hash(code)
						const now = yield* DateTime.now
						yield* Ref.update(codes, current =>
							pipe(
								current,
								HashMap.filter(entry => DateTime.isGreaterThan(entry.expiresAt, now)),
								HashMap.set<string, Code>(key, {
									expiresAt: DateTime.addDuration(now, Duration.minutes(1)),
									state: {_tag: 'Fresh', owner, request}
								})
							)
						)
						return code
					}, asAuthError('Cannot issue the authorization code')),
					issuer,
					jwks: {keys: [publicJwk]},
					revoke: Effect.fn('Tokens.revoke')(
						function* (params: RevokeParams) {
							yield* Option.match(parts(params.token), {
								onNone: () => Effect.void,
								onSome: Effect.fnUntraced(function* (found) {
									yield* Reactivity.mutation(
										deleteRevoked({clientId: params.client_id, family: found.family, hash: yield* hash(found.secret)}),
										['tokens']
									)
								})
							})
						},
						withReactivity,
						asAuthError('Cannot revoke the token')
					),
					session,
					sessionVia,
					startSession: Effect.fn('Tokens.startSession')(
						function* (owner: CredentialOwner, origin: Origin, via: SessionVia, previousToken: Option.Option<string>) {
							const family = SignInFamily.make(yield* randomToken(16))
							const sessionSecret = yield* randomToken(32)
							const seconds = pipe(
								Match.value(via),
								Match.when('Code', () => Duration.days(30)),
								Match.when('GitHub', () => Duration.days(365)),
								Match.when('Passkey', () => Duration.days(365)),
								Match.exhaustive
							)
							const sessionHash = yield* hash(sessionSecret)
							const previous = yield* Effect.transposeOption(
								pipe(
									previousToken,
									Option.flatMap(parts),
									Option.map(prior =>
										Effect.map(hash(prior.secret), presented => ({family: prior.family, hash: presented}))
									)
								)
							)
							// Retire only the browser session presented here, in the same transaction as its replacement.
							yield* pipe(
								Effect.gen(function* () {
									const now = yield* DateTime.now
									yield* deleteExpired(now)
									yield* Option.match(previous, {
										onNone: () => Effect.void,
										onSome: Effect.fnUntraced(function* (prior) {
											if (
												Option.exists(
													yield* findSession({family: prior.family, now}),
													found => found.hash === prior.hash
												)
											) {
												yield* deleteFamily(prior.family)
											}
										})
									})
									yield* insertSession({
										address: origin.address,
										client: browserLabel(origin),
										device: deviceLabel(origin),
										expiresAt: DateTime.addDuration(now, seconds),
										family,
										hash: sessionHash,
										incarnation: owner.incarnation,
										lastActive: now,
										userId: owner.user.id,
										userName: owner.user.name,
										via
									})
								}),
								Reactivity.mutation(['tokens']),
								sql.withTransaction
							)
							return {seconds, token: `${family}.${sessionSecret}`}
						},
						withReactivity,
						asAuthError('Cannot start the session')
					),
					verify,
					// The list is read again on each change and once a minute, so expired sign-ins leave it.
					watchApps: owner =>
						pipe(
							sql.reactive(['tokens'], listApps(owner)),
							Stream.merge(
								pipe(
									Stream.tick('1 minute'),
									Stream.drop(1),
									Stream.mapEffect(() => listApps(owner))
								)
							),
							Stream.withSpan('Tokens.watchApps', {attributes: {'rpc.stream': true, userId: owner.user.id}})
						)
				})
			})
		),
		this.migrations
	)
}
