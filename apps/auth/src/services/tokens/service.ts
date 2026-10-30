import type {Stream} from 'effect'
import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Path,
	Predicate,
	Record,
	Ref,
	Result,
	Schema,
	Semaphore,
	String,
	Struct,
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

import {Changes} from '#services/changes/service.ts'
import {MemberRow, Members} from '#services/people/schema.ts'
import {given, matchingRedirect} from '#services/tokens/lib/utils.ts'
import type {
	AuthorizeClient,
	ClientRequest,
	Registration,
	RevokeParams,
	SignedInApp,
	Stored,
	TokenParams
} from '#services/tokens/schema.ts'
import {Exchange, LegacyState, TokenEntry, TokenState} from '#services/tokens/schema.ts'

const REFRESH_SECONDS = 30 * 86_400

export const SESSION_COOKIE = '__Secure-session'

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

function bearer(headers: Headers.Headers) {
	// RFC 9110 auth schemes are case-insensitive and may be followed by more than one space.
	return Option.flatMapNullishOr(
		String.match(/^bearer +(?<token>\S+) *$/iu)(headers['authorization'] ?? ''),
		found => found.groups?.['token']
	)
}

// The clients an unredeemed code or a live refresh token still belongs to.
function clientsInUse(tokens: TokenState) {
	return Array.dedupe(
		Array.flatMap(Record.values(tokens), entry => {
			if (entry.payload._tag === 'Code' || entry.payload._tag === 'Refresh') return [entry.payload.clientId]
			return []
		})
	)
}

// Anyone can register a client, so only the newest stay besides those in use; an agent whose idle client was dropped registers again.
function newestClients(tokens: TokenState, inUse: HashSet.HashSet<string>) {
	const kept = pipe(
		Record.toEntries(tokens),
		Array.filter(pair => pair[1].payload._tag === 'Client' && !HashSet.has(inUse, pair[0])),
		Array.sort(Order.flip(Order.mapInput(Order.Number, (pair: [string, TokenEntry]) => pair[1].expiresAt))),
		Array.take(200),
		Array.map(pair => pair[0]),
		HashSet.fromIterable
	)
	return Record.filter(
		tokens,
		(entry, key) => entry.payload._tag !== 'Client' || HashSet.has(kept, key) || HashSet.has(inUse, key)
	)
}

function withoutFamily(tokens: TokenState, family: string) {
	return Record.filter(
		tokens,
		entry =>
			!(
				(entry.payload._tag === 'Access' ||
					entry.payload._tag === 'Refresh' ||
					entry.payload._tag === 'UsedCode' ||
					entry.payload._tag === 'UsedRefresh') &&
				entry.payload.family === family
			)
	)
}

// Members and tokens live under ~/.deslop/auth; the previous release kept both in one `state` value, split here once.
export const layerStore = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth')
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
		return Layer.tap(layerKeyValueStore(directory), context =>
			Effect.gen(function* () {
				const store = Context.get(context, KeyValueStore.KeyValueStore)
				// Sign-ins in progress, GitHub steps and codes no longer live here; they end with the release.
				const split = Effect.fnUntraced(function* (legacy: LegacyState) {
					yield* KeyValueStore.toSchemaStore(store, Members).set(
						'members',
						Array.getSomes(Array.map(legacy.members, row => Schema.decodeUnknownOption(MemberRow)(row)))
					)
					yield* KeyValueStore.toSchemaStore(store, TokenState).set(
						'tokens',
						Record.getSomes(Record.map(legacy.tokens, entry => Schema.decodeUnknownOption(TokenEntry)(entry)))
					)
					yield* store.remove('state')
				})
				yield* Option.match(yield* KeyValueStore.toSchemaStore(store, LegacyState).get('state'), {
					onNone: () => Effect.void,
					onSome: split
				})
			})
		)
	})
)

export class Tokens extends Context.Service<
	Tokens,
	{
		readonly access: (headers: Headers.Headers, resource: string) => Effect.Effect<User, AuthError>
		readonly apps: (user: User) => Stream.Stream<SignedInApp[], AuthError>
		readonly client: (asked: AuthorizeClient) => Effect.Effect<{clientName: string; redirectUri: string}, AuthError>
		readonly delegate: (headers: Headers.Headers, resource: Resource) => Effect.Effect<string, AuthError>
		readonly disconnect: (family: string, user: User) => Effect.Effect<void, AuthError>
		readonly endSession: (headers: Headers.Headers) => Effect.Effect<void, AuthError>
		readonly exchange: (params: TokenParams, address: Option.Option<string>) => Effect.Effect<Exchange, AuthError>
		readonly forget: (id: string) => Effect.Effect<void, AuthError>
		readonly issue: (request: ClientRequest, user: User) => Effect.Effect<string, AuthError>
		readonly register: (registration: Registration) => Effect.Effect<string, AuthError>
		readonly revoke: (params: RevokeParams) => Effect.Effect<void, AuthError>
		readonly session: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		readonly startSession: (user: User) => Effect.Effect<string, AuthError>
	}
>()('@deslop/auth/services/tokens/service/Tokens') {
	static readonly layer = Layer.effect(
		Tokens,
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, TokenState)
			const state = yield* Ref.make<TokenState>(Option.getOrElse(yield* store.get('tokens'), () => ({})))
			const writes = yield* Semaphore.make(1)
			const changes = yield* Changes
			const random = yield* SecureRandom.SecureRandom
			const digest = yield* Digest.Digest
			// Every change reads and writes the whole map under one permit, so a decision and its effects apply together.
			const transact = Effect.fnUntraced(
				function* <A, E>(change: (draft: Ref.Ref<TokenState>) => Effect.Effect<A, E>) {
					const before = yield* Ref.get(state)
					const draft = yield* Ref.make(before)
					const result = yield* change(draft)
					const after = yield* Ref.get(draft)
					if (after !== before) {
						yield* store.set('tokens', after)
						yield* Ref.set(state, after)
						yield* changes.publish
					}
					return result
				},
				Effect.uninterruptible,
				writes.withPermit
			)
			const hash = Effect.fnUntraced(function* (value: string) {
				return Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(value)))
			})
			const mint = Effect.fnUntraced(function* (payload: Stored, seconds: number, draft: Ref.Ref<TokenState>) {
				const token = Base64Url.encode(yield* random.randomBytes(32))
				const now = yield* Clock.currentTimeMillis
				const key = yield* hash(token)
				yield* Ref.update(draft, current => ({
					...Record.filter(current, entry => entry.expiresAt > now),
					[key]: {expiresAt: now + seconds * 1000, payload}
				}))
				return token
			})
			const load = Effect.fnUntraced(function* (token: string, draft: Ref.Ref<TokenState> = state) {
				const now = yield* Clock.currentTimeMillis
				return yield* pipe(
					Record.get(yield* Ref.get(draft), yield* hash(token)),
					Option.filter(entry => entry.expiresAt > now),
					Option.map(entry => entry.payload),
					Effect.fromOption,
					Effect.mapError(cause =>
						AuthError.make({cause, error: 'invalid_grant', message: 'The authorization expired. Sign in again.'})
					)
				)
			})
			const remove = Effect.fnUntraced(function* (token: string, draft: Ref.Ref<TokenState>) {
				yield* Ref.update(draft, Record.remove(yield* hash(token)))
			})
			// A redeemed grant keeps its expiry as a marker of its family, so its replay is caught.
			const retire = Effect.fnUntraced(function* (
				token: string,
				payload: typeof Stored.cases.UsedCode.Type | typeof Stored.cases.UsedRefresh.Type,
				draft: Ref.Ref<TokenState>
			) {
				const key = yield* hash(token)
				yield* Ref.update(draft, current =>
					pipe(
						Record.modify(current, key, entry => ({...entry, payload})),
						Option.getOrElse(() => current)
					)
				)
			})
			const access = Effect.fn('Tokens.access')(function* (headers: Headers.Headers, resource: string) {
				const stored = yield* Effect.flatMap(Effect.fromOption(bearer(headers)), token => load(token))
				if (stored._tag !== 'Access' || !Array.some(stored.resources, value => value === resource)) {
					return yield* AuthError.make({message: 'The token is not valid for this app'})
				}
				return stored.user
			}, rejected('Sign in first'))
			const session = Effect.fn('Tokens.session')(function* (headers: Headers.Headers) {
				const stored = yield* load(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '')
				if (stored._tag !== 'Session') return yield* AuthError.make({message: 'Sign in first'})
				return stored.user
			}, rejected('Sign in first'))
			const clientName = Effect.fnUntraced(function* (refresh: typeof Stored.cases.Refresh.Type, tokens: TokenState) {
				if (refresh.clientName !== undefined) return refresh.clientName
				return pipe(
					Record.get(tokens, yield* hash(refresh.clientId)),
					Option.flatMap(entry => {
						if (entry.payload._tag !== 'Client') return Option.none()
						return Option.fromUndefinedOr(entry.payload.name)
					}),
					Option.getOrElse(() => 'Unknown client')
				)
			})
			// Each client registers anew per sign-in, so a second sign-in of the same client, apps and address replaces the first instead of adding a row.
			const replaceSignIns = Effect.fnUntraced(function* (
				grant: typeof Stored.cases.Refresh.Type,
				draft: Ref.Ref<TokenState>
			) {
				if (Predicate.isUndefined(grant.address)) return
				const current = yield* Ref.get(draft)
				const name = yield* clientName(grant, current)
				const sameApps = Array.makeEquivalence(String.Equivalence)
				const replaced = yield* Effect.filter(
					Array.flatMap(Record.values(current), entry => {
						if (
							entry.payload._tag !== 'Refresh' ||
							entry.payload.user.id !== grant.user.id ||
							entry.payload.address !== grant.address ||
							!sameApps(Array.sort(entry.payload.resources, String.Order), Array.sort(grant.resources, String.Order))
						) {
							return []
						}
						return [entry.payload]
					}),
					earlier => Effect.map(clientName(earlier, current), earlierName => earlierName === name),
					{concurrency: 'unbounded'}
				)
				for (const family of Array.dedupe(Array.map(replaced, earlier => earlier.family))) {
					yield* Ref.update(draft, tokens => withoutFamily(tokens, family))
				}
			})
			const grant = Effect.fnUntraced(function* (
				refresh: typeof Stored.cases.Refresh.Type,
				resources: typeof Stored.cases.Access.Type.resources,
				draft: Ref.Ref<TokenState>
			) {
				// A queued iOS upload cannot refresh its bearer after the share sheet closes.
				const seconds = Boolean.match(Array.contains(resources, 'https://stash.mp281x.xyz'), {
					onFalse: () => 900,
					onTrue: () => 90_000
				})
				return Exchange.cases.Granted.make({
					tokens: {
						access_token: yield* mint(
							{_tag: 'Access', family: refresh.family, resources, user: refresh.user},
							seconds,
							draft
						),
						expires_in: seconds,
						refresh_token: yield* mint(refresh, REFRESH_SECONDS, draft),
						scope: 'deslop',
						token_type: 'Bearer'
					}
				})
			})
			const tokenResources = Effect.fnUntraced(function* (
				params: TokenParams,
				granted: typeof Stored.cases.Access.Type.resources
			) {
				if (params.resource === undefined) return granted
				if (!Array.every(params.resource, value => Array.contains(granted, value))) {
					return yield* AuthError.make({error: 'invalid_target', message: 'The resource was not authorized'})
				}
				return params.resource
			})
			const listApps = Effect.fnUntraced(function* (user: User) {
				const now = yield* Clock.currentTimeMillis
				const current = yield* Ref.get(state)
				const apps = yield* Effect.forEach(
					Array.flatMap(Record.values(current), entry => {
						if (entry.expiresAt <= now || entry.payload._tag !== 'Refresh' || entry.payload.user.id !== user.id) {
							return []
						}
						return [{expiresAt: entry.expiresAt, refresh: entry.payload}]
					}),
					Effect.fnUntraced(function* (row) {
						return {
							clientName: yield* clientName(row.refresh, current),
							family: row.refresh.family,
							lastActive: row.expiresAt - REFRESH_SECONDS * 1000,
							resources: row.refresh.resources
						} satisfies SignedInApp
					}),
					{concurrency: 'unbounded'}
				)
				return Array.sort(apps, Order.flip(Order.mapInput(Order.Number, (app: SignedInApp) => app.lastActive)))
			})

			return Tokens.of({
				access,
				// Each app sign-in is one refresh-token family whose live token was minted at its last refresh, newest first.
				apps: user =>
					changes.watch(listApps(user), apps =>
						pipe(
							Array.map(apps, app => app.lastActive + REFRESH_SECONDS * 1000),
							Array.reduce(Infinity, Number.min)
						)
					),
				client: Effect.fn('Tokens.client')(function* (asked: AuthorizeClient) {
					const unregistered = AuthError.make({
						error: 'invalid_client',
						message: 'This client is not registered; start the sign-in again in the app'
					})
					const registration = yield* Effect.mapError(load(asked.client_id), () => unregistered)
					if (registration._tag !== 'Client') return yield* unregistered
					const redirectUri = yield* pipe(
						matchingRedirect(registration, given(asked.redirect_uri)),
						Effect.fromOption,
						Effect.mapError(cause =>
							AuthError.make({cause, message: 'The callback does not match the registered client'})
						)
					)
					return {clientName: registration.name ?? 'Unknown client', redirectUri}
				}),
				delegate: Effect.fn('Tokens.delegate')(function* (headers: Headers.Headers, resource: Resource) {
					yield* access(headers, `${AUTH_URL}/mcp`)
					return yield* transact(draft =>
						Effect.gen(function* () {
							const source = yield* Effect.flatMap(Effect.fromOption(bearer(headers)), token => load(token, draft))
							if (source._tag !== 'Access') return yield* AuthError.make({message: 'Sign in first'})
							return yield* mint({...source, resources: [resource]}, 60, draft)
						})
					)
				}, rejected('Cannot authorize the upstream MCP')),
				disconnect: Effect.fn('Tokens.disconnect')(function* (family: string, user: User) {
					yield* transact(draft =>
						Effect.gen(function* () {
							const owned = Array.some(
								Record.values(yield* Ref.get(draft)),
								entry =>
									entry.payload._tag === 'Refresh' &&
									entry.payload.family === family &&
									entry.payload.user.id === user.id
							)
							if (!owned) return yield* AuthError.make({message: 'This app is already disconnected'})
							yield* Ref.update(draft, tokens => withoutFamily(tokens, family))
						})
					)
				}, rejected('Cannot disconnect this app')),
				endSession: Effect.fn('Tokens.endSession')(function* (headers: Headers.Headers) {
					yield* transact(draft => remove(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '', draft))
				}, rejected('Cannot sign out')),
				exchange: Effect.fn('Tokens.exchange')(function* (params: TokenParams, address: Option.Option<string>) {
					return yield* transact(draft =>
						Effect.gen(function* () {
							if (params.grant_type === 'authorization_code') {
								const code = yield* load(params.code, draft)
								if (code._tag === 'UsedCode') {
									yield* Ref.update(draft, tokens => withoutFamily(tokens, code.family))
									return Exchange.cases.Replayed.make({
										message:
											'This authorization code was already used, so the tokens it gave are revoked; sign in again'
									})
								}
								if (
									code._tag !== 'Code' ||
									code.clientId !== params.client_id ||
									Option.exists(given(params.redirect_uri), sent => sent !== code.redirectUri) ||
									code.challenge !== (yield* hash(params.code_verifier))
								) {
									return yield* AuthError.make({
										error: 'invalid_grant',
										message: 'The authorization code, its client, callback or verifier do not match'
									})
								}
								const resources = yield* tokenResources(params, code.resources)
								const family = Base64Url.encode(yield* random.randomBytes(32))
								yield* retire(params.code, {_tag: 'UsedCode', clientId: code.clientId, family}, draft)
								const refresh = {
									_tag: 'Refresh' as const,
									...Struct.pick(code, ['clientId', 'clientName', 'resources', 'user']),
									family,
									...Option.match(address, {onNone: () => ({}), onSome: value => ({address: value})})
								}
								yield* replaceSignIns(refresh, draft)
								return yield* grant(refresh, resources, draft)
							}
							const refresh = yield* load(params.refresh_token, draft)
							if (refresh._tag === 'UsedRefresh') {
								yield* Ref.update(draft, tokens => withoutFamily(tokens, refresh.family))
								return Exchange.cases.Replayed.make({
									message: 'This refresh token was already used, so its sign-in is revoked; sign in again'
								})
							}
							if (
								refresh._tag !== 'Refresh' ||
								Option.exists(given(params.client_id), sent => sent !== refresh.clientId)
							) {
								return yield* AuthError.make({
									error: 'invalid_grant',
									message: 'The refresh token belongs to another client'
								})
							}
							const resources = yield* tokenResources(params, refresh.resources)
							yield* retire(
								params.refresh_token,
								{_tag: 'UsedRefresh', clientId: refresh.clientId, family: refresh.family},
								draft
							)
							return yield* grant(refresh, resources, draft)
						})
					)
				}, rejected('Invalid token request')),
				// Removing an account signs it out everywhere: its session, its app tokens and any code it approved but did not deliver.
				forget: Effect.fn('Tokens.forget')(function* (id: string) {
					yield* transact(draft =>
						Ref.update(draft, current =>
							Record.filter(
								current,
								entry =>
									!(
										(entry.payload._tag === 'Access' ||
											entry.payload._tag === 'Code' ||
											entry.payload._tag === 'Refresh' ||
											entry.payload._tag === 'Session') &&
										entry.payload.user.id === id
									)
							)
						)
					)
				}, rejected('Cannot sign this account out')),
				issue: Effect.fn('Tokens.issue')(function* (request: ClientRequest, user: User) {
					return yield* transact(draft =>
						mint(
							{
								_tag: 'Code',
								...Struct.pick(request, ['challenge', 'clientId', 'clientName', 'redirectUri', 'resources', 'state']),
								user
							},
							60,
							draft
						)
					)
				}, rejected('Cannot issue the authorization code')),
				register: Effect.fn('Tokens.register')(function* (registration: Registration) {
					return yield* transact(draft =>
						Effect.gen(function* () {
							const token = yield* mint(
								{
									_tag: 'Client',
									name: registration.client_name ?? 'Unknown client',
									redirects: registration.redirect_uris
								},
								365 * 86_400,
								draft
							)
							const inUse = HashSet.fromIterable(
								yield* Effect.forEach(clientsInUse(yield* Ref.get(draft)), clientId => hash(clientId), {
									concurrency: 'unbounded'
								})
							)
							yield* Ref.update(draft, current => newestClients(current, inUse))
							return token
						})
					)
				}, rejected('Cannot register the client')),
				revoke: Effect.fn('Tokens.revoke')(function* (params: RevokeParams) {
					yield* transact(draft =>
						Effect.gen(function* () {
							const token = yield* Effect.result(load(params.token, draft))
							if (
								Result.isSuccess(token) &&
								(token.success._tag === 'Refresh' || token.success._tag === 'UsedRefresh') &&
								token.success.clientId === params.client_id
							) {
								const family = token.success.family
								yield* Ref.update(draft, tokens => withoutFamily(tokens, family))
							}
						})
					)
				}, rejected('Cannot revoke the token')),
				session,
				startSession: Effect.fn('Tokens.startSession')(function* (user: User) {
					return yield* transact(draft => mint({_tag: 'Session', user}, 365 * 86_400, draft))
				}, rejected('Cannot start the session'))
			})
		})
	)
}
