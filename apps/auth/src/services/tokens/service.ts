import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	HashMap,
	Layer,
	Match,
	Number,
	Option,
	Record,
	Redacted,
	Ref,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import {Digest, SecureRandom, Signature} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import type {Jwks} from 'effect/jose'
import {KeyValueStore} from 'effect/persistence'

import {AccessClaims, AuthError} from '@deslop/runtime/auth/schema'
import {ACCESS_SECONDS, ISSUER_PATH, bearerOf, rejected} from '@deslop/runtime/auth/utils'

import {
	browserLabel,
	browserToken,
	clientLabel,
	clientOf,
	deviceLabel,
	given,
	hashOf,
	live,
	matchingRedirect,
	randomTokenOf,
	sameOwner,
	signedInApps,
	storedOrigin
} from '#services/tokens/lib/utils.ts'
import type {
	AuthorizeClient,
	ClientRequest,
	CredentialOwner,
	DeviceRequest,
	Grant,
	Origin,
	RevokeParams,
	SessionVia,
	SignedInApp,
	TokenParams,
	TokenResponse
} from '#services/tokens/schema.ts'
import {Exchange, Grants} from '#services/tokens/schema.ts'

// An authorization code lives 60 seconds in memory; once redeemed it names the family it gave, so a replay ends it.
type Code = {
	expiresAt: number
	state: {_tag: 'Fresh'; request: ClientRequest; owner: CredentialOwner} | {_tag: 'Used'; family: string}
}

const expired = AuthError.make({error: 'invalid_grant', message: 'The authorization expired. Sign in again.'})

// A token is its grant's family, a dot and its secret; a refresh token also names its generation.
function parts(token: string) {
	return Option.map(
		String.match(/^(?<family>[\w-]{16,64})\.(?:(?<generation>\d{1,9})\.)?(?<secret>[\w-]{16,64})$/u)(token),
		found => ({
			family: found.groups?.['family'] ?? '',
			generation: Option.getOrElse(Number.parse(found.groups?.['generation'] ?? ''), () => -1),
			secret: found.groups?.['secret'] ?? ''
		})
	)
}

function end(grants: Grants, family: string) {
	return Record.filter(grants, (grant, key) => key !== family && grant.parent !== family)
}

// Touch a grant at most once a minute, and not at all once it is gone or already touched since the read.
function touch(current: Grants, family: string, now: number) {
	return Option.match(Record.get(current, family), {
		onNone: () => current,
		onSome: grant =>
			Boolean.match(now - grant.lastActive > 60_000, {
				onFalse: () => current,
				onTrue: () => ({...current, [family]: {...grant, lastActive: now}})
			})
	})
}

// Signed-in apps and browsers live under ~/.deslop/auth; codes and sign-ins in progress stay in memory.
export class Tokens extends Context.Service<
	Tokens,
	{
		readonly apps: (owner: CredentialOwner) => Stream.Stream<SignedInApp[], AuthError>
		readonly changes: Stream.Stream<void>
		readonly client: (asked: AuthorizeClient) => Effect.Effect<{clientName: string; redirectUri: string}, AuthError>
		readonly device: (
			request: DeviceRequest,
			owner: CredentialOwner,
			origin: Origin
		) => Effect.Effect<TokenResponse, AuthError>
		readonly disconnect: (family: string, owner: CredentialOwner) => Effect.Effect<void, AuthError>
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
		) => Effect.Effect<{family: string; owner: CredentialOwner; via: SessionVia}, AuthError>
		readonly startSession: (
			owner: CredentialOwner,
			origin: Origin,
			via: SessionVia,
			previous: string
		) => Effect.Effect<{seconds: number; token: string}, AuthError>
		readonly verify: (headers: Headers.Headers) => Effect.Effect<CredentialOwner, AuthError>
	}
>()('@deslop/auth/services/tokens/service/Tokens') {
	static readonly layer = Layer.effect(
		Tokens,
		Effect.gen(function* () {
			const storage = yield* KeyValueStore.KeyValueStore
			const store = KeyValueStore.toSchemaStore(storage, Grants)
			const grants = yield* SubscriptionRef.make<Grants>(Option.getOrElse(yield* store.get('sign-ins'), () => ({})))
			const issuer = `${new URL(yield* Config.String('APP_URL')).origin}${ISSUER_PATH}`
			const keys = KeyValueStore.toSchemaStore(storage, Schema.RedactedFromValue(Jwk.PrivateJwk))
			const privateJwk = yield* Option.match(yield* keys.get('signing-key'), {
				onNone: () =>
					pipe(
						Jwk.generateKeyPair({algorithm: 'EdDSA'}),
						Effect.flatMap(pair => Jwk.importPrivate(pair.privateKey, 'EdDSA')),
						Effect.flatMap(Jwk.exportPrivate),
						Effect.tap(key => keys.set('signing-key', key))
					),
				onSome: Effect.succeed
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
			// Every change saves the next grants before memory and the live views see them.
			const change = Effect.fnUntraced(function* <A, E>(
				update: (current: Grants, now: number) => Effect.Effect<readonly [A, Grants], E>
			) {
				return yield* SubscriptionRef.modifyEffect(grants, current =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis
						const [result, next] = yield* update(live(current, now), now)
						yield* store.set('sign-ins', next)
						return [result, next] as const
					})
				)
			}, Effect.uninterruptible)
			const grantOf = Effect.fnUntraced(function* (token: string) {
				const found = yield* Effect.fromOption(parts(token))
				const now = yield* Clock.currentTimeMillis
				return {
					...found,
					grant: yield* Effect.fromOption(Record.get(live(yield* SubscriptionRef.get(grants), now), found.family)),
					hash: yield* hash(found.secret),
					now
				}
			})
			const browser = Effect.fnUntraced(function* (headers: Headers.Headers) {
				const found = yield* grantOf(browserToken(headers))
				if (found.grant.credential._tag !== 'Browser' || found.grant.credential.hash !== found.hash) {
					return yield* AuthError.make({message: 'Sign in first'})
				}
				return {
					family: found.family,
					owner: {incarnation: found.grant.incarnation, user: found.grant.user},
					via: found.grant.credential.via
				}
			}, rejected('Sign in first'))
			const session = Effect.fn('Tokens.session')(function* (headers: Headers.Headers) {
				return (yield* browser(headers)).owner
			})
			const sessionVia = Effect.fn('Tokens.sessionVia')(function* (headers: Headers.Headers) {
				return (yield* browser(headers)).via
			})
			const verify = Effect.fn('Tokens.verify')(function* (headers: Headers.Headers) {
				const verified = yield* Effect.provideService(
					Jwt.verify(AccessClaims, yield* Effect.fromOption(bearerOf(headers)), publicKey, {
						audience: 'deslop',
						issuer,
						typ: 'at+jwt'
					}),
					Signature.Signature,
					signature
				)
				const now = yield* Clock.currentTimeMillis
				const signedIn = yield* Effect.fromOption(
					Record.get(live(yield* SubscriptionRef.get(grants), now), verified.claims.sid)
				)
				if (signedIn.credential._tag !== 'App' || signedIn.user.id !== verified.claims.sub) {
					return yield* AuthError.make({message: 'Sign in first'})
				}
				const found = {family: verified.claims.sid, grant: signedIn, now}
				// Touch the grant at most once a minute, so a token's last use shows without a write per tool call.
				if (found.now - found.grant.lastActive > 60_000) {
					yield* pipe(
						change(current => Effect.succeed([undefined, touch(current, found.family, found.now)] as const)),
						Effect.ignore({log: 'Warn', message: 'The token’s last use could not be saved'})
					)
				}
				return {incarnation: found.grant.incarnation, user: found.grant.user}
			}, rejected('Sign in first'))
			const mint = Effect.fnUntraced(function* (
				family: string,
				generation: number,
				owner: CredentialOwner,
				client: string,
				now: number
			) {
				const refreshSecret = yield* randomToken(32)
				const iat = Math.floor(now / 1000)
				const access = yield* Effect.provideService(
					Jwt.sign(
						AccessClaims,
						{
							aud: 'deslop',
							azp: client,
							exp: iat + ACCESS_SECONDS,
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
					// A refresh token lasts 30 days from its last use.
					refresh: {expiresAt: now + 30 * 86_400_000, hash: yield* hash(refreshSecret)},
					tokens: {
						access_token: Redacted.value(access),
						expires_in: ACCESS_SECONDS,
						refresh_token: `${family}.${generation}.${refreshSecret}`,
						scope: 'deslop' as const,
						token_type: 'Bearer' as const
					}
				}
			})
			const signIn = Effect.fnUntraced(function* (
				current: Grants,
				now: number,
				family: string,
				request: DeviceRequest & {parent?: string},
				owner: CredentialOwner,
				origin: Origin
			) {
				const minted = yield* pipe(
					mint(family, 0, owner, clientLabel(request.clientName), now),
					rejected('Cannot sign the access token')
				)
				const grant: Grant = {
					client: clientLabel(request.clientName),
					credential: {_tag: 'App', clientId: request.clientId, generation: 0, replaced: [], ...minted.refresh},
					device: deviceLabel(origin),
					lastActive: now,
					origin: storedOrigin(origin),
					...Struct.pick(request, ['parent']),
					...owner
				}
				const kept = Record.filter(
					current,
					other =>
						!(
							sameOwner(other, grant) &&
							other.client === grant.client &&
							other.device === grant.device &&
							other.parent === grant.parent &&
							other.credential._tag === 'App'
						)
				)
				return [minted.tokens, {...kept, [family]: grant}] as const
			})
			const redeem = Effect.fnUntraced(
				function* (
					params: Extract<TokenParams, {grant_type: 'authorization_code'}>,
					origin: Origin,
					allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
				) {
					const key = yield* hash(params.code)
					const verifier = yield* hash(params.code_verifier)
					const family = yield* randomToken(16)
					// The grant commits before its code is marked used; concurrent redemptions take turns through both steps.
					const result = yield* change<Exchange, AuthError>((current, now) =>
						Effect.gen(function* () {
							const code = yield* pipe(
								HashMap.get(yield* Ref.get(codes), key),
								Option.filter(entry => entry.expiresAt > now),
								Effect.fromOption,
								Effect.mapError(() => expired)
							)
							if (code.state._tag === 'Used') {
								return [
									Exchange.cases.Replayed.make({
										message:
											'This authorization code was already used, so the tokens it gave are revoked; sign in again'
									}),
									Record.remove(current, code.state.family)
								] as const
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
							if (
								fresh.request.parent !== undefined &&
								!Option.exists(
									Record.get(current, fresh.request.parent),
									parent => parent.credential._tag === 'Browser' && sameOwner(parent, fresh.owner)
								)
							) {
								return yield* expired
							}
							const started = yield* signIn(current, now, family, fresh.request, fresh.owner, origin)
							return [Exchange.cases.Granted.make({tokens: started[0]}), started[1]] as const
						})
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
				const presented = yield* Effect.mapError(Effect.fromOption(parts(params.refresh_token)), () => expired)
				const presentedHash = yield* hash(presented.secret)
				return yield* change<Exchange, AuthError>((current, now) =>
					Effect.gen(function* () {
						const grant = yield* Effect.mapError(
							Effect.fromOption(Record.get(current, presented.family)),
							() => expired
						)
						const credential = grant.credential
						if (
							credential._tag !== 'App' ||
							Option.exists(given(params.client_id), sent => sent !== credential.clientId)
						) {
							return yield* AuthError.make({
								error: 'invalid_grant',
								message: 'The refresh token belongs to another client'
							})
						}
						// Only a spent token's secret proves a replay; a guess at the family ends nothing.
						if (presented.generation < credential.generation && Array.contains(credential.replaced, presentedHash)) {
							return [
								Exchange.cases.Replayed.make({
									message: 'This refresh token was already used, so its sign-in is revoked; sign in again'
								}),
								Record.remove(current, presented.family)
							] as const
						}
						if (presented.generation !== credential.generation || presentedHash !== credential.hash) {
							return yield* expired
						}
						yield* allowed(grant)
						const minted = yield* pipe(
							mint(presented.family, credential.generation + 1, grant, grant.client, now),
							rejected('Cannot sign the access token')
						)
						return [
							Exchange.cases.Granted.make({tokens: minted.tokens}),
							{
								...current,
								[presented.family]: {
									...grant,
									credential: {
										...credential,
										generation: credential.generation + 1,
										replaced: [...credential.replaced, credential.hash],
										...minted.refresh
									},
									// Recomputed, so a sign-in labelled by an older rule takes the current one on its next refresh.
									device: deviceLabel(origin),
									lastActive: now,
									origin: storedOrigin(origin)
								}
							}
						] as const
					})
				)
			})
			const listApps = Effect.fnUntraced(function* (owner: CredentialOwner) {
				const now = yield* Clock.currentTimeMillis
				return signedInApps(yield* SubscriptionRef.get(grants), now, owner)
			})

			return Tokens.of({
				// The list is read again on each change and once a minute, so expired sign-ins leave it.
				apps: user =>
					pipe(
						Stream.merge(SubscriptionRef.changes(grants), Stream.drop(Stream.tick('1 minute'), 1)),
						Stream.mapEffect(() => listApps(user))
					),
				browserSession: browser,
				changes: Stream.map(SubscriptionRef.changes(grants), () => undefined),
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
				device: Effect.fn('Tokens.device')(function* (request: DeviceRequest, owner: CredentialOwner, origin: Origin) {
					const family = yield* randomToken(16)
					return yield* change((current, now) => signIn(current, now, family, request, owner, origin))
				}, rejected('Cannot sign the command in')),
				disconnect: Effect.fn('Tokens.disconnect')(function* (family: string, owner: CredentialOwner) {
					yield* change(current =>
						Effect.gen(function* () {
							if (!Option.exists(Record.get(current, family), grant => sameOwner(grant, owner))) {
								return yield* AuthError.make({message: 'This sign-in has already ended'})
							}
							return [undefined, end(current, family)] as const
						})
					)
				}, rejected('Cannot sign this out')),
				endSession: Effect.fn('Tokens.endSession')(function* (headers: Headers.Headers) {
					yield* Option.match(
						Option.filter(
							yield* Effect.option(grantOf(browserToken(headers))),
							current => current.grant.credential._tag === 'Browser' && current.grant.credential.hash === current.hash
						),
						{
							onNone: () => Effect.void,
							onSome: own => change(saved => Effect.succeed([undefined, end(saved, own.family)] as const))
						}
					)
				}, rejected('Cannot sign out')),
				exchange: Effect.fn('Tokens.exchange')(function* (
					params: TokenParams,
					origin: Origin,
					allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
				) {
					if (params.grant_type === 'authorization_code') return yield* redeem(params, origin, allowed)
					return yield* rotate(params, origin, allowed)
				}, rejected('Invalid token request')),
				// Removing an account signs it out everywhere; a sign-in it approved but not yet delivered checks the account at delivery.
				forget: Effect.fn('Tokens.forget')(function* (owner: CredentialOwner) {
					yield* change(current =>
						Effect.succeed([undefined, Record.filter(current, grant => !sameOwner(grant, owner))] as const)
					)
					yield* Ref.update(
						codes,
						HashMap.filter(entry => entry.state._tag === 'Used' || !sameOwner(entry.state.owner, owner))
					)
				}, rejected('Cannot sign this account out')),
				issue: Effect.fn('Tokens.issue')(function* (request: ClientRequest, owner: CredentialOwner) {
					const code = yield* randomToken(32)
					const key = yield* hash(code)
					const now = yield* Clock.currentTimeMillis
					yield* Ref.update(codes, current =>
						HashMap.set(
							HashMap.filter(current, entry => entry.expiresAt > now),
							key,
							{expiresAt: now + 60_000, state: {_tag: 'Fresh', owner, request}}
						)
					)
					return code
				}, rejected('Cannot issue the authorization code')),
				issuer,
				jwks: {keys: [publicJwk]},
				revoke: Effect.fn('Tokens.revoke')(function* (params: RevokeParams) {
					// RFC 7009: the client's own refresh token ends its sign-in; anything else changes nothing.
					yield* Option.match(parts(params.token), {
						onNone: () => Effect.void,
						onSome: Effect.fnUntraced(function* (found) {
							const presented = yield* hash(found.secret)
							yield* change(current =>
								Effect.succeed([
									undefined,
									Boolean.match(
										Option.exists(
											Record.get(current, found.family),
											grant =>
												grant.credential._tag === 'App' &&
												grant.credential.clientId === params.client_id &&
												grant.credential.hash === presented
										),
										{onFalse: () => current, onTrue: () => Record.remove(current, found.family)}
									)
								] as const)
							)
						})
					})
				}, rejected('Cannot revoke the token')),
				session,
				sessionVia,
				startSession: Effect.fn('Tokens.startSession')(function* (
					owner: CredentialOwner,
					origin: Origin,
					via: SessionVia,
					previousToken: string
				) {
					const family = yield* randomToken(16)
					const sessionSecret = yield* randomToken(32)
					const seconds = pipe(
						Match.value(via),
						Match.when('Code', () => 30 * 86_400),
						Match.when('GitHub', () => 365 * 86_400),
						Match.when('Passkey', () => 365 * 86_400),
						Match.exhaustive
					)
					const sessionHash = yield* hash(sessionSecret)
					const previous = yield* Effect.transposeOption(
						Option.map(parts(previousToken), prior =>
							Effect.map(hash(prior.secret), presented => ({family: prior.family, hash: presented}))
						)
					)
					// Retire only the browser credential presented here, in the same durable write as its replacement.
					yield* change((current, now) => {
						const retained = Option.match(previous, {
							onNone: () => current,
							onSome: prior => {
								if (
									Option.exists(
										Record.get(current, prior.family),
										grant => grant.credential._tag === 'Browser' && grant.credential.hash === prior.hash
									)
								) {
									return end(current, prior.family)
								}
								return current
							}
						})
						return Effect.succeed([
							undefined,
							{
								...retained,
								[family]: {
									client: browserLabel(origin),
									credential: {_tag: 'Browser' as const, expiresAt: now + seconds * 1000, hash: sessionHash, via},
									device: deviceLabel(origin),
									lastActive: now,
									origin: storedOrigin(origin),
									...owner
								}
							}
						] as const)
					})
					return {seconds, token: `${family}.${sessionSecret}`}
				}, rejected('Cannot start the session')),
				verify
			})
		})
	)
}
