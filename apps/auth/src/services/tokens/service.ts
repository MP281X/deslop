import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	HashMap,
	Layer,
	Match,
	Number,
	Option,
	Order,
	Path,
	Record,
	Ref,
	Schema,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import type {Resource, User} from '@deslop/runtime/auth/schema'
import {AuthError} from '@deslop/runtime/auth/schema'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import {layerKeyValueStore} from '@deslop/runtime/server'

import {browserLabel, clientLabel, clientOf, deviceLabel, given, matchingRedirect} from '#services/tokens/lib/utils.ts'
import type {
	AuthorizeClient,
	ClientRequest,
	Grant,
	Origin,
	RevokeParams,
	SignedInApp,
	TokenParams
} from '#services/tokens/schema.ts'
import {Exchange, Grants} from '#services/tokens/schema.ts'

export const SESSION_COOKIE = '__Secure-session'

// A GitHub sign-in is the owner's own browser; a code may have been approved for someone else's, so it ends sooner.
type SessionVia = typeof SessionVia.Type
const SessionVia = Schema.Literals(['Code', 'GitHub'])

// An authorization code lives 60 seconds in memory; once redeemed it names the family it gave, so a replay ends it.
type Code = {
	expiresAt: number
	state: {_tag: 'Fresh'; request: ClientRequest; user: User} | {_tag: 'Used'; family: string}
}
// A delegated token lets the gateway call one of the owner's MCP servers as the caller, for 60 seconds.
type Delegated = {expiresAt: number; resource: Resource; user: User}

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
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

// The grants still alive, each with only its unexpired access tokens.
function live(grants: Grants, now: number) {
	return Record.map(
		Record.filter(grants, grant => grant.credential.expiresAt > now),
		grant =>
			Match.valueTags(grant.credential, {
				App: app => ({
					...grant,
					credential: {...app, access: Array.filter(app.access, entry => entry.expiresAt > now)}
				}),
				Browser: () => grant
			})
	)
}

// Signed-in apps and browsers live under ~/.deslop/auth; codes, delegated tokens and sign-ins in progress stay in memory.
export const layerStore = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth')
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
		return layerKeyValueStore(directory)
	})
)

export class Tokens extends Context.Service<
	Tokens,
	{
		readonly access: (headers: Headers.Headers, resource: string) => Effect.Effect<User, AuthError>
		readonly apps: (user: User) => Stream.Stream<SignedInApp[], AuthError>
		// Each saved change to the signed-in apps and browsers, starting with the current state.
		readonly changes: Stream.Stream<void>
		readonly client: (asked: AuthorizeClient) => Effect.Effect<{clientName: string; redirectUri: string}, AuthError>
		readonly delegate: (headers: Headers.Headers, resource: Resource) => Effect.Effect<string, AuthError>
		readonly disconnect: (family: string, user: User) => Effect.Effect<void, AuthError>
		readonly endSession: (headers: Headers.Headers) => Effect.Effect<void, AuthError>
		// Tokens go only to an account `allowed` still accepts, so a removal between approval and exchange takes effect.
		readonly exchange: (
			params: TokenParams,
			origin: Origin,
			allowed: (user: User) => Effect.Effect<User, AuthError>
		) => Effect.Effect<Exchange, AuthError>
		readonly forget: (id: string) => Effect.Effect<void, AuthError>
		readonly issue: (request: ClientRequest, user: User) => Effect.Effect<string, AuthError>
		readonly revoke: (params: RevokeParams) => Effect.Effect<void, AuthError>
		readonly session: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		readonly startSession: (
			user: User,
			origin: Origin,
			via: SessionVia
		) => Effect.Effect<{seconds: number; token: string}, AuthError>
	}
>()('@deslop/auth/services/tokens/service/Tokens') {
	static readonly layer = Layer.effect(
		Tokens,
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Grants)
			const grants = yield* SubscriptionRef.make<Grants>(Option.getOrElse(yield* store.get('grants'), () => ({})))
			const codes = yield* Ref.make(HashMap.empty<string, Code>())
			const delegated = yield* Ref.make(HashMap.empty<string, Delegated>())
			const random = yield* SecureRandom.SecureRandom
			const digest = yield* Digest.Digest
			function secret(bytes: number) {
				return Effect.map(random.randomBytes(bytes), Base64Url.encode)
			}
			const hash = Effect.fnUntraced(function* (value: string) {
				return Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(value)))
			})
			// Every change saves the next grants before memory and the live views see them.
			const change = Effect.fnUntraced(function* <A, E>(
				update: (current: Grants, now: number) => Effect.Effect<readonly [A, Grants], E>
			) {
				return yield* SubscriptionRef.modifyEffect(grants, current =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis
						const [result, next] = yield* update(live(current, now), now)
						yield* store.set('grants', next)
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
			const session = Effect.fn('Tokens.session')(function* (headers: Headers.Headers) {
				const found = yield* grantOf(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '')
				if (found.grant.credential._tag !== 'Browser' || found.grant.credential.hash !== found.hash) {
					return yield* AuthError.make({message: 'Sign in first'})
				}
				return found.grant.user
			}, rejected('Sign in first'))
			const access = Effect.fn('Tokens.access')(function* (headers: Headers.Headers, resource: string) {
				// RFC 9110 auth schemes are case-insensitive and may be followed by more than one space.
				const token = yield* Effect.fromOption(
					Option.flatMapNullishOr(
						String.match(/^bearer +(?<token>\S+) *$/iu)(headers['authorization'] ?? ''),
						found => found.groups?.['token']
					)
				)
				const now = yield* Clock.currentTimeMillis
				const invalid = AuthError.make({message: 'The token is not valid for this app'})
				return yield* Option.match(HashMap.get(yield* Ref.get(delegated), yield* hash(token)), {
					onNone: () =>
						Effect.flatMap(grantOf(token), found => {
							if (
								found.grant.credential._tag !== 'App' ||
								!Array.some(
									found.grant.credential.access,
									entry => entry.hash === found.hash && Array.contains(entry.resources, resource)
								)
							) {
								return Effect.fail(invalid)
							}
							return Effect.succeed(found.grant.user)
						}),
					onSome: forwarded => {
						if (forwarded.expiresAt <= now || forwarded.resource !== resource) return Effect.fail(invalid)
						return Effect.succeed(forwarded.user)
					}
				})
			}, rejected('Sign in first'))
			const mint = Effect.fnUntraced(function* (
				family: string,
				generation: number,
				resources: readonly Resource[],
				now: number
			) {
				const accessSecret = yield* secret(32)
				const refreshSecret = yield* secret(32)
				// A queued iOS upload cannot refresh its bearer after the share sheet closes.
				const seconds = Boolean.match(Array.contains(resources, 'https://stash.mp281x.xyz'), {
					onFalse: () => 900,
					onTrue: () => 90_000
				})
				return {
					access: {expiresAt: now + seconds * 1000, hash: yield* hash(accessSecret), resources},
					// A refresh token lasts 30 days from its last use.
					refresh: {expiresAt: now + 30 * 86_400_000, hash: yield* hash(refreshSecret)},
					tokens: {
						access_token: `${family}.${accessSecret}`,
						expires_in: seconds,
						refresh_token: `${family}.${generation}.${refreshSecret}`,
						scope: 'deslop' as const,
						token_type: 'Bearer' as const
					}
				}
			})
			const tokenResources = Effect.fnUntraced(function* (params: TokenParams, granted: readonly Resource[]) {
				if (params.resource === undefined) return granted
				if (!Array.every(params.resource, value => Array.contains(granted, value))) {
					return yield* AuthError.make({error: 'invalid_target', message: 'The resource was not authorized'})
				}
				return params.resource
			})
			const redeem = Effect.fnUntraced(function* (
				params: Extract<TokenParams, {grant_type: 'authorization_code'}>,
				origin: Origin,
				allowed: (user: User) => Effect.Effect<User, AuthError>
			) {
				const key = yield* hash(params.code)
				const verifier = yield* hash(params.code_verifier)
				const family = yield* secret(16)
				// Redemption runs inside one change, so of two concurrent ones the second sees the code used and ends what the first gave.
				return yield* change<Exchange, AuthError>((current, now) =>
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
									message: 'This authorization code was already used, so the tokens it gave are revoked; sign in again'
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
						yield* allowed(fresh.user)
						const resources = yield* tokenResources(params, fresh.request.resources)
						yield* Ref.update(codes, entries =>
							HashMap.set(entries, key, {expiresAt: code.expiresAt, state: {_tag: 'Used' as const, family}})
						)
						const minted = yield* mint(family, 0, resources, now)
						const grant: Grant = {
							client: clientLabel(fresh.request.clientName),
							createdAt: now,
							credential: {
								_tag: 'App',
								access: [minted.access],
								clientId: fresh.request.clientId,
								generation: 0,
								resources: fresh.request.resources,
								...minted.refresh
							},
							device: deviceLabel(origin, Option.some(fresh.request.redirectUri)),
							lastActive: now,
							origin,
							user: fresh.user
						}
						// Each sign-in registers anew, so a second one of the same client, device and apps replaces the first.
						return [
							Exchange.cases.Granted.make({tokens: minted.tokens}),
							{
								...Record.filter(
									current,
									other =>
										!(
											other.user.id === grant.user.id &&
											other.client === grant.client &&
											other.device === grant.device &&
											other.credential._tag === 'App' &&
											Array.makeEquivalence(String.Equivalence)(
												Array.sort(other.credential.resources, String.Order),
												Array.sort(fresh.request.resources, String.Order)
											)
										)
								),
								[family]: grant
							}
						] as const
					})
				)
			})
			const rotate = Effect.fnUntraced(function* (
				params: Extract<TokenParams, {grant_type: 'refresh_token'}>,
				origin: Origin,
				allowed: (user: User) => Effect.Effect<User, AuthError>
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
						if (presented.generation >= 0 && presented.generation < credential.generation) {
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
						yield* allowed(grant.user)
						const minted = yield* mint(
							presented.family,
							credential.generation + 1,
							yield* tokenResources(params, credential.resources),
							now
						)
						return [
							Exchange.cases.Granted.make({tokens: minted.tokens}),
							{
								...current,
								[presented.family]: {
									...grant,
									credential: {
										...credential,
										access: [...credential.access, minted.access],
										generation: credential.generation + 1,
										...minted.refresh
									},
									lastActive: now,
									origin
								}
							}
						] as const
					})
				)
			})
			const listApps = Effect.fnUntraced(function* (user: User) {
				const now = yield* Clock.currentTimeMillis
				return pipe(
					Record.toEntries(live(yield* SubscriptionRef.get(grants), now)),
					Array.filter(entry => entry[1].user.id === user.id),
					Array.map(
						entry =>
							({
								client: entry[1].client,
								device: entry[1].device,
								family: entry[0],
								kind: entry[1].credential._tag,
								lastActive: entry[1].lastActive,
								resources: Boolean.match(entry[1].credential._tag === 'App', {
									onFalse: () => [],
									onTrue: () => {
										if (entry[1].credential._tag === 'App') return entry[1].credential.resources
										return []
									}
								}),
								...Option.match(Option.fromUndefinedOr(entry[1].origin.address), {
									onNone: () => ({}),
									onSome: address => ({address})
								})
							}) satisfies SignedInApp
					),
					Array.sort(Order.flip(Order.mapInput(Order.Number, (app: SignedInApp) => app.lastActive)))
				)
			})

			return Tokens.of({
				access,
				// The list is read again on each change and once a minute, so expired sign-ins leave it.
				apps: user =>
					pipe(
						Stream.merge(SubscriptionRef.changes(grants), Stream.drop(Stream.tick('1 minute'), 1)),
						Stream.mapEffect(() => listApps(user))
					),
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
				delegate: Effect.fn('Tokens.delegate')(function* (headers: Headers.Headers, resource: Resource) {
					const user = yield* access(headers, `${AUTH_URL}/mcp`)
					const token = yield* secret(32)
					const key = yield* hash(token)
					const now = yield* Clock.currentTimeMillis
					yield* Ref.update(delegated, current =>
						HashMap.set(
							HashMap.filter(current, entry => entry.expiresAt > now),
							key,
							{expiresAt: now + 60_000, resource, user}
						)
					)
					return token
				}, rejected('Cannot authorize the upstream MCP')),
				disconnect: Effect.fn('Tokens.disconnect')(function* (family: string, user: User) {
					yield* change(current =>
						Effect.gen(function* () {
							if (!Option.exists(Record.get(current, family), grant => grant.user.id === user.id)) {
								return yield* AuthError.make({message: 'This sign-in has already ended'})
							}
							return [undefined, Record.remove(current, family)] as const
						})
					)
				}, rejected('Cannot sign this out')),
				endSession: Effect.fn('Tokens.endSession')(function* (headers: Headers.Headers) {
					const found = yield* Effect.option(
						grantOf(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '')
					)
					yield* Option.match(
						Option.filter(found, current => current.grant.credential.hash === current.hash),
						{
							onNone: () => Effect.void,
							onSome: own => change(saved => Effect.succeed([undefined, Record.remove(saved, own.family)] as const))
						}
					)
				}, rejected('Cannot sign out')),
				exchange: Effect.fn('Tokens.exchange')(function* (
					params: TokenParams,
					origin: Origin,
					allowed: (user: User) => Effect.Effect<User, AuthError>
				) {
					if (params.grant_type === 'authorization_code') return yield* redeem(params, origin, allowed)
					return yield* rotate(params, origin, allowed)
				}, rejected('Invalid token request')),
				// Removing an account signs it out everywhere; a sign-in it approved but not yet delivered checks the account at delivery.
				forget: Effect.fn('Tokens.forget')(function* (id: string) {
					yield* change(current =>
						Effect.succeed([undefined, Record.filter(current, grant => grant.user.id !== id)] as const)
					)
					yield* Ref.update(
						codes,
						HashMap.filter(entry => entry.state._tag === 'Used' || entry.state.user.id !== id)
					)
					yield* Ref.update(
						delegated,
						HashMap.filter(entry => entry.user.id !== id)
					)
				}, rejected('Cannot sign this account out')),
				issue: Effect.fn('Tokens.issue')(function* (request: ClientRequest, user: User) {
					const code = yield* secret(32)
					const key = yield* hash(code)
					const now = yield* Clock.currentTimeMillis
					yield* Ref.update(codes, current =>
						HashMap.set(
							HashMap.filter(current, entry => entry.expiresAt > now),
							key,
							{expiresAt: now + 60_000, state: {_tag: 'Fresh', request, user}}
						)
					)
					return code
				}, rejected('Cannot issue the authorization code')),
				revoke: Effect.fn('Tokens.revoke')(function* (params: RevokeParams) {
					yield* Option.match(parts(params.token), {
						onNone: () => Effect.void,
						onSome: found =>
							change(current =>
								Effect.succeed([
									undefined,
									Boolean.match(
										Option.exists(
											Record.get(current, found.family),
											grant => grant.credential._tag === 'App' && grant.credential.clientId === params.client_id
										),
										{onFalse: () => current, onTrue: () => Record.remove(current, found.family)}
									)
								] as const)
							)
					})
				}, rejected('Cannot revoke the token')),
				session,
				startSession: Effect.fn('Tokens.startSession')(function* (user: User, origin: Origin, via: SessionVia) {
					const family = yield* secret(16)
					const sessionSecret = yield* secret(32)
					const seconds = pipe(
						Match.value(via),
						Match.when('Code', () => 30 * 86_400),
						Match.when('GitHub', () => 365 * 86_400),
						Match.exhaustive
					)
					const sessionHash = yield* hash(sessionSecret)
					yield* change((current, now) =>
						Effect.succeed([
							undefined,
							{
								...current,
								[family]: {
									client: browserLabel(origin),
									createdAt: now,
									credential: {_tag: 'Browser' as const, expiresAt: now + seconds * 1000, hash: sessionHash},
									device: deviceLabel(origin, Option.none()),
									lastActive: now,
									origin,
									user
								}
							}
						] as const)
					)
					return {seconds, token: `${family}.${sessionSecret}`}
				}, rejected('Cannot start the session'))
			})
		})
	)
}
