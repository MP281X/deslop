import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Crypto,
	Effect,
	FileSystem,
	HashSet,
	Layer,
	Match,
	Number,
	Option,
	Order,
	Path,
	PubSub,
	Record,
	Redacted,
	Ref,
	Result,
	Schema,
	Semaphore,
	String,
	Stream,
	Struct,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'
import type {Headers} from 'effect/http'
import {
	Cookies,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	Url,
	UrlParams
} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AuthError, User} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import {layerKeyValueStore} from '@deslop/runtime/server'

import type {AdmitParams, PendingAuthorization, Role, MemberRow, Stored} from '#services/authorizations/schema.ts'
import {
	Account,
	AuthState,
	AuthorizationStatus,
	AuthorizeParams,
	CallbackParams,
	ConsentParams,
	GitHubToken,
	GitHubUser,
	Person,
	Registration,
	RevokeParams,
	SignInParams,
	TokenParams,
	VerificationParams
} from '#services/authorizations/schema.ts'

const SESSION_COOKIE = '__Secure-session'
const LOGIN_COOKIE = '__Host-login'
const REQUEST_COOKIE = '__Host-request-'
const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const
const ROLE_ORDER = {Admin: 0, Member: 2, Waiting: 1} satisfies Record<Role, number>
// A request's id is the code its sign-in page shows, in RFC 8628's user-code letters: no vowels and no letters that read alike.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

function oauth<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		handler,
		Effect.catchIf(Schema.is(AuthError), failure =>
			Effect.succeed(
				HttpServerResponse.jsonUnsafe(
					{error: failure.error ?? 'invalid_request', error_description: failure.message},
					{status: 400}
				)
			)
		),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}

function publicRequest(request: typeof Stored.cases.Request.Type, expiresAt: number) {
	return {...pipe(request, Struct.pick(['clientName', 'createdAt', 'id', 'redirectUri', 'resources'])), expiresAt}
}

function allowedRedirect(redirect: string) {
	// The iOS apps in their release and Simulator builds, or a loopback callback of a desktop agent.
	return (
		Array.contains(
			[
				'stash://auth/callback',
				'stash-dev://auth/callback',
				'opm://auth/callback',
				'opm-dev://auth/callback',
				'trips://auth/callback',
				'trips-dev://auth/callback'
			],
			redirect
		) ||
		Result.match(Url.fromString(redirect), {
			onFailure: () => false,
			onSuccess: target =>
				target.protocol === 'http:' &&
				(target.hostname === '127.0.0.1' || target.hostname === 'localhost') &&
				String.isEmpty(target.username) &&
				String.isEmpty(target.password) &&
				String.isEmpty(target.search) &&
				String.isEmpty(target.hash)
		})
	)
}

// A web sign-in returns to the page that started it only over https on the auth app's own domain or a subdomain.
function returnable(next: string, url: string) {
	const domain = pipe(new URL(url).hostname, String.split('.'), Array.drop(1), Array.join('.'))
	return Result.match(Url.fromString(next), {
		onFailure: () => false,
		onSuccess: target =>
			target.protocol === 'https:' &&
			(target.hostname === domain || String.endsWith(`.${domain}`)(target.hostname)) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password)
	})
}

// Anyone can register a client, so only the newest stay; an agent whose client was dropped registers again.
function newestClients(tokens: AuthState['tokens']) {
	const kept = pipe(
		Record.toEntries(tokens),
		Array.filter(pair => pair[1].payload._tag === 'Client'),
		Array.sort(Order.flip(Order.mapInput(Order.Number, (pair: [string, {expiresAt: number}]) => pair[1].expiresAt))),
		Array.take(200),
		Array.map(pair => pair[0]),
		HashSet.fromIterable
	)
	return Record.filter(tokens, (entry, key) => entry.payload._tag !== 'Client' || HashSet.has(kept, key))
}

function revokeFamily(family: string, draft: Ref.Ref<AuthState>) {
	return Ref.update(draft, current => ({
		...current,
		tokens: Record.filter(
			current.tokens,
			entry =>
				!(
					(entry.payload._tag === 'Access' ||
						entry.payload._tag === 'Refresh' ||
						entry.payload._tag === 'UsedRefresh') &&
					entry.payload.family === family
				)
		)
	}))
}

// Removing an account signs it out everywhere: its session, its app tokens and any sign-in it approved but did not deliver.
function forget(id: string, draft: Ref.Ref<AuthState>) {
	return Ref.update(draft, current => ({
		members: Array.filter(current.members, row => row.id !== id),
		tokens: Record.filter(
			current.tokens,
			entry =>
				!(
					((entry.payload._tag === 'Access' ||
						entry.payload._tag === 'Code' ||
						entry.payload._tag === 'Refresh' ||
						entry.payload._tag === 'Session') &&
						entry.payload.user.id === id) ||
					(entry.payload._tag === 'Request' &&
						entry.payload.decision._tag === 'Approved' &&
						entry.payload.decision.user.id === id)
				)
		)
	}))
}

export class Authorizations extends Context.Service<
	Authorizations,
	{
		readonly account: (headers: Headers.Headers) => Stream.Stream<Account, AuthError>
		readonly admit: (params: AdmitParams, user: User) => Effect.Effect<Person, AuthError>
		readonly answer: (params: ConsentParams, user: User) => Effect.Effect<{clientName: string}, AuthError>
		readonly listPeople: (user: User) => Effect.Effect<Person[], AuthError>
		readonly lookup: (
			code: string,
			headers: Headers.Headers
		) => Stream.Stream<Option.Option<PendingAuthorization>, AuthError>
		readonly people: (user: User) => Stream.Stream<Person[], AuthError>
		readonly remove: (id: string, user: User) => Effect.Effect<Person, AuthError>
		readonly wait: (id: string, headers: Headers.Headers) => Stream.Stream<AuthorizationStatus, AuthError>
	}
>()('@deslop/auth/services/authorizations/service/Authorizations') {
	static readonly layer = pipe(
		Layer.effectContext(
			Effect.gen(function* () {
				const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, AuthState)
				const state = yield* Ref.make<AuthState>(
					Option.getOrElse(yield* store.get('state'), () => ({members: [], tokens: {}}))
				)
				const writes = yield* Semaphore.make(1)
				function transact<A, E, R>(change: (draft: Ref.Ref<AuthState>) => Effect.Effect<A, E, R>) {
					return writes.withPermit(
						Effect.uninterruptible(
							Effect.gen(function* () {
								const before = yield* Ref.get(state)
								const draft = yield* Ref.make(before)
								const result = yield* change(draft)
								const after = yield* Ref.get(draft)
								if (after !== before) {
									yield* store.set('state', after)
									yield* Ref.set(state, after)
								}
								return result
							})
						)
					)
				}
				const random = yield* Crypto.Crypto
				const changes = yield* PubSub.sliding<true>(1)
				const router = yield* HttpRouter.HttpRouter
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
				const issuer = `${url}/api/auth`
				const provider = yield* Config.all({
					admins: Config.Array(Schema.String, 'GITHUB_ADMINS'),
					clientId: Config.String('GITHUB_CLIENT_ID'),
					secret: Config.Redacted('GITHUB_CLIENT_SECRET')
				})
				const hash = Effect.fnUntraced(function* (value: string) {
					return Base64Url.encode(yield* random.digest('SHA-256', new TextEncoder().encode(value)))
				})
				const mint = Effect.fnUntraced(function* (payload: Stored, seconds: number, draft: Ref.Ref<AuthState>) {
					const token = Base64Url.encode(yield* random.randomBytes(32))
					const now = yield* Clock.currentTimeMillis
					const key = yield* hash(token)
					yield* Ref.update(draft, current => ({
						...current,
						tokens: {
							...Record.filter(current.tokens, entry => entry.expiresAt > now),
							[key]: {expiresAt: now + seconds * 1000, payload}
						}
					}))
					return token
				})
				const load = Effect.fnUntraced(function* (token: string, draft: Ref.Ref<AuthState> = state) {
					const now = yield* Clock.currentTimeMillis
					return yield* pipe(
						Record.get((yield* Ref.get(draft)).tokens, yield* hash(token)),
						Option.filter(entry => entry.expiresAt > now),
						Option.map(entry => entry.payload),
						Effect.fromOption,
						Effect.mapError(cause =>
							AuthError.make({cause, error: 'invalid_grant', message: 'The authorization expired. Sign in again.'})
						)
					)
				})
				const remove = Effect.fnUntraced(function* (token: string, draft: Ref.Ref<AuthState>) {
					const key = yield* hash(token)
					yield* Ref.update(draft, current => ({...current, tokens: Record.remove(current.tokens, key)}))
				})
				function isAdmin(id: string) {
					return Array.contains(provider.admins, String.replace('github:', '')(id))
				}
				const members = pipe(
					Ref.get(state),
					Effect.map(current =>
						Array.sort(
							Array.reverse(current.members),
							Order.flip(Order.mapInput(Order.Number, (row: MemberRow) => row.since))
						)
					)
				)
				function member(id: string, draft: Ref.Ref<AuthState> = state) {
					return Effect.map(Ref.get(draft), current => Array.findFirst(current.members, row => row.id === id))
				}
				function personOf(row: MemberRow) {
					return Person.make({
						...pipe(row, Struct.pick(['id', 'name', 'since'])),
						...Boolean.match(String.isEmpty(row.fullName), {
							onFalse: () => ({fullName: row.fullName}),
							onTrue: () => ({})
						}),
						role: Boolean.match(isAdmin(row.id), {
							onFalse: () =>
								Boolean.match(row.status === 'Allowed', {
									onFalse: () => 'Waiting' as const,
									onTrue: () => 'Member' as const
								}),
							onTrue: () => 'Admin' as const
						})
					})
				}
				// An admin who has not signed in since GITHUB_ADMINS named them still shows their GitHub profile.
				yield* pipe(
					Effect.forEach(
						provider.admins,
						Effect.fnUntraced(function* (id) {
							if (Option.isSome(yield* member(`github:${id}`))) return
							const github = yield* pipe(
								HttpClientRequest.get(`https://api.github.com/user/${id}`),
								HttpClientRequest.setHeaders({accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}),
								request => client.execute(request),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
								Effect.timeout('10 seconds')
							)
							const since = yield* Clock.currentTimeMillis
							yield* transact(draft =>
								Ref.update(draft, current => {
									if (Array.some(current.members, row => row.id === `github:${github.id}`)) return current
									return {
										...current,
										members: [
											...current.members,
											{
												fullName: github.name ?? '',
												id: `github:${github.id}`,
												name: github.login,
												since,
												status: 'Allowed' as const
											}
										]
									}
								})
							)
							yield* PubSub.publish(changes, true)
						}),
						{concurrency: 1, discard: true}
					),
					Effect.ignore({log: 'Warn', message: 'The admins’ GitHub profiles could not be read'}),
					Effect.forkScoped
				)
				const roleOf = Effect.fnUntraced(function* (user: User, draft: Ref.Ref<AuthState> = state) {
					if (isAdmin(user.id)) return 'Admin' as const
					return Option.match(yield* member(user.id, draft), {
						onNone: () => 'Waiting' as const,
						onSome: row => personOf(row).role
					})
				}, rejected('Cannot read the account'))
				const allowed = Effect.fnUntraced(function* (user: User, draft: Ref.Ref<AuthState> = state) {
					if ((yield* roleOf(user, draft)) === 'Waiting') {
						return yield* AuthError.make({
							error: 'access_denied',
							message: 'An admin has not allowed this GitHub account yet'
						})
					}
					return user
				})
				const admin = Effect.fnUntraced(function* (user: User) {
					if (!isAdmin(user.id)) {
						return yield* AuthError.make({error: 'access_denied', message: 'Only an admin can manage people'})
					}
				})
				// Signed in with GitHub, allowed or not: the auth app shows a waiting account its state.
				const signedIn = Effect.fnUntraced(function* (headers: Headers.Headers) {
					const stored = yield* load(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '')
					if (stored._tag !== 'Session') return yield* AuthError.make({message: 'Sign in first'})
					return stored.user
				}, rejected('Sign in first'))
				const session = Effect.fnUntraced(function* (headers: Headers.Headers) {
					return yield* allowed(yield* signedIn(headers))
				})
				const access = Effect.fn('Auth.access')(function* (headers: Headers.Headers, resource: string) {
					const authorization = headers['authorization'] ?? ''
					if (!String.startsWith('Bearer ')(authorization)) return yield* AuthError.make({message: 'Sign in first'})
					const stored = yield* load(String.slice(7)(authorization))
					if (stored._tag !== 'Access' || !Array.some(stored.resources, value => value === resource)) {
						return yield* AuthError.make({message: 'The token is not valid for this app'})
					}
					return yield* allowed(stored.user)
				}, rejected('Sign in first'))
				const checkOrigin = Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (headers['origin'] !== new URL(url).origin) {
						return yield* AuthError.make({error: 'access_denied', message: 'The request comes from another origin'})
					}
				})
				const sameOrigin = Effect.flatMap(HttpServerRequest.HttpServerRequest, request => checkOrigin(request.headers))
				const requestRow = Effect.fnUntraced(function* (id: string, draft: Ref.Ref<AuthState> = state) {
					const now = yield* Clock.currentTimeMillis
					return yield* pipe(
						Ref.get(draft),
						Effect.map(current =>
							pipe(
								Record.toEntries(current.tokens),
								Array.findFirst(
									pair =>
										pair[1].expiresAt > now &&
										(pair[1].payload._tag === 'Request' || pair[1].payload._tag === 'Delivered') &&
										pair[1].payload.id === id
								),
								Option.map(pair => ({...pair[1], hash: pair[0]}))
							)
						)
					)
				})
				const requestState = Effect.fnUntraced(function* (id: string, draft: Ref.Ref<AuthState>) {
					const stored = (yield* Effect.fromOption(yield* requestRow(id, draft))).payload
					if (stored._tag !== 'Request') return yield* AuthError.make({message: 'The authorization request expired'})
					return stored
				}, rejected('The authorization request expired'))
				const receiver = Effect.fnUntraced(function* (
					id: string,
					headers: Headers.Headers,
					draft: Ref.Ref<AuthState> = state
				) {
					const token = Cookies.parseHeader(headers['cookie'] ?? '')[`${REQUEST_COOKIE}${id}`]
					if (token === undefined) {
						return yield* AuthError.make({message: 'Open the authorization link again'})
					}
					return yield* Option.match(yield* requestRow(id, draft), {
						onNone: () => Effect.succeedNone,
						onSome: Effect.fnUntraced(function* (row) {
							if (row.hash !== (yield* hash(token))) {
								return yield* AuthError.make({message: 'The authorization belongs to another browser'})
							}
							return Option.some(row)
						})
					})
				})
				function watch<A>(read: Effect.Effect<A, AuthError>, expires: (value: A) => number) {
					return Stream.unwrap(
						Effect.gen(function* () {
							const subscription = yield* PubSub.subscribe(changes)
							return Stream.unfold(Option.none<number>(), previous =>
								Effect.gen(function* () {
									yield* Option.match(previous, {
										onNone: () => Effect.void,
										onSome: expiresAt =>
											Effect.raceFirst(
												PubSub.take(subscription),
												Boolean.match(expiresAt === Infinity, {
													onFalse: () =>
														Effect.flatMap(Clock.currentTimeMillis, now =>
															Effect.sleep(Number.max(0, expiresAt - now))
														),
													onTrue: () => Effect.never
												})
											)
									})
									const value = yield* read
									return [value, Option.some(expires(value))] as const
								})
							)
						})
					)
				}
				// A waiting sign-in is read only by its code, in any case and with or without the dash, so no account lists anyone else's.
				const pendingRequest = Effect.fnUntraced(function* (typed: string) {
					return yield* Option.match(yield* requestRow(String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(typed))), {
						onNone: () => Effect.succeedNone,
						onSome: Effect.fnUntraced(function* (row) {
							if (row.payload._tag !== 'Request' || row.payload.decision._tag !== 'Pending') return Option.none()
							return Option.some(publicRequest(row.payload, row.expiresAt))
						})
					})
				})
				const lookup = Effect.fnUntraced(function* (code: string, headers: Headers.Headers) {
					yield* session(headers)
					return yield* pendingRequest(code)
				}, rejected('Cannot read the sign-in'))
				const decide = Effect.fnUntraced(function* (params: ConsentParams, user: User) {
					yield* transact(draft =>
						Effect.gen(function* () {
							const request = yield* requestState(params.request, draft)
							if (request.decision._tag !== 'Pending') {
								return yield* AuthError.make({message: 'This authorization has already been answered'})
							}
							yield* Ref.update(draft, current => ({
								...current,
								tokens: Record.map(current.tokens, entry => {
									if (entry.payload._tag !== 'Request' || entry.payload.id !== params.request) return entry
									return {
										...entry,
										payload: {
											...request,
											decision: Boolean.match(params.accept, {
												onFalse: () => ({_tag: 'Denied' as const}),
												onTrue: () => ({_tag: 'Approved' as const, user})
											})
										}
									}
								})
							}))
						})
					)
					yield* PubSub.publish(changes, true)
				})
				const respond = Effect.fn('Authorizations.respond')(function* (
					params: ConsentParams,
					headers: Headers.Headers
				) {
					yield* checkOrigin(headers)
					yield* decide(params, yield* session(headers))
				}, rejected('Cannot answer the authorization request'))
				const answer = Effect.fn('Authorizations.answer')(function* (params: ConsentParams, user: User) {
					yield* allowed(user)
					const request = yield* pipe(
						yield* pendingRequest(params.request),
						Effect.fromOption,
						Effect.mapError(cause =>
							AuthError.make({cause, message: 'No waiting sign-in has this code; start it again'})
						)
					)
					yield* decide({accept: params.accept, request: request.id}, user)
					return {clientName: request.clientName}
				}, rejected('Cannot answer the authorization request'))
				// Every GitHub sign-in is recorded with its session in one transaction: an admin as allowed, anyone else as asking for access until an admin answers.
				const register = Effect.fnUntraced(function* (github: GitHubUser) {
					const user = {id: `github:${github.id}`, name: github.login}
					const status = Boolean.match(isAdmin(user.id), {
						onFalse: () => 'Waiting' as const,
						onTrue: () => 'Allowed' as const
					})
					const since = yield* Clock.currentTimeMillis
					const token = yield* transact(draft =>
						Effect.gen(function* () {
							yield* Ref.update(draft, current => ({
								...current,
								members: Option.match(
									Array.findFirst(current.members, row => row.id === user.id),
									{
										onNone: () => [...current.members, {fullName: github.name ?? '', ...user, since, status}],
										onSome: () =>
											Array.map(current.members, row => {
												if (row.id !== user.id) return row
												return {...row, fullName: github.name ?? '', name: user.name}
											})
									}
								)
							}))
							return yield* mint({_tag: 'Session', user}, 365 * 86400, draft)
						})
					)
					yield* PubSub.publish(changes, true)
					return token
				})
				const account = Effect.fnUntraced(function* (headers: Headers.Headers) {
					const user = yield* signedIn(headers)
					const role = yield* roleOf(user)
					return Option.match(yield* member(user.id), {
						onNone: () => Account.make({...user, role}),
						onSome: row => Account.make(pipe(personOf(row), Struct.omit(['since'])))
					})
				}, rejected('Cannot read the account'))
				// Admins first, then the accounts asking for access, then members, each newest first.
				const listPeople = Effect.fn('Authorizations.listPeople')(function* (user: User) {
					yield* admin(user)
					const known = Array.map(yield* members, personOf)
					return Array.sort(
						[
							...Array.map(
								Array.filter(provider.admins, id => !Array.some(known, person => person.id === `github:${id}`)),
								id => Person.make({id: `github:${id}`, name: `GitHub ${id}`, role: 'Admin', since: 0})
							),
							...known
						],
						Order.mapInput(Number.Order, (person: Person) => ROLE_ORDER[person.role])
					)
				}, rejected('Cannot read people'))
				// Each answer reads and changes the account in one transaction, so two answers to the same account cannot both apply.
				const admit = Effect.fn('Authorizations.admit')(function* (params: AdmitParams, user: User) {
					yield* admin(user)
					const person = yield* transact(draft =>
						Effect.gen(function* () {
							const found = personOf(yield* Effect.fromOption(yield* member(params.id, draft)))
							if (found.role !== 'Waiting') {
								return yield* AuthError.make({message: 'This account is not asking for access'})
							}
							if (!params.allow) {
								yield* forget(params.id, draft)
								return found
							}
							const now = yield* Clock.currentTimeMillis
							yield* Ref.update(draft, current => ({
								...current,
								members: Array.map(current.members, row => {
									if (row.id !== params.id) return row
									return {...row, since: now, status: 'Allowed' as const}
								})
							}))
							return Person.make({...found, role: 'Member', since: now})
						})
					)
					yield* PubSub.publish(changes, true)
					return person
				}, rejected('Cannot answer the access request'))
				const removePerson = Effect.fn('Authorizations.remove')(function* (id: string, user: User) {
					yield* admin(user)
					if (isAdmin(id)) {
						return yield* AuthError.make({message: 'Admins come from GITHUB_ADMINS, so they cannot be removed here'})
					}
					const person = yield* transact(draft =>
						Effect.gen(function* () {
							const found = personOf(yield* Effect.fromOption(yield* member(id, draft)))
							yield* forget(id, draft)
							return found
						})
					)
					yield* PubSub.publish(changes, true)
					return person
				}, rejected('Cannot remove this account'))
				const receive = Effect.fnUntraced(function* (id: string, headers: Headers.Headers) {
					return yield* transact(draft =>
						Effect.flatMap(receiver(id, headers, draft), result =>
							Option.match(result, {
								onNone: () => Effect.succeed(AuthorizationStatus.make({_tag: 'Expired'})),
								onSome: Effect.fnUntraced(function* (row) {
									if (row.payload._tag === 'Delivered') {
										return AuthorizationStatus.make({_tag: 'Completed', url: row.payload.url})
									}
									if (row.payload._tag !== 'Request') {
										return yield* AuthError.make({message: 'Invalid authorization request'})
									}
									if (row.payload.decision._tag === 'Pending') {
										return AuthorizationStatus.make({
											_tag: 'Waiting',
											request: publicRequest(row.payload, row.expiresAt)
										})
									}
									const target = new URL(row.payload.redirectUri)
									target.searchParams.set('state', row.payload.state)
									target.searchParams.set('iss', issuer)
									if (row.payload.decision._tag === 'Approved') {
										target.searchParams.set(
											'code',
											yield* mint(
												{
													...pipe(
														row.payload,
														Struct.pick(['challenge', 'clientId', 'redirectUri', 'resources', 'state'])
													),
													_tag: 'Code',
													user: row.payload.decision.user
												},
												60,
												draft
											)
										)
									} else {
										target.searchParams.set('error', 'access_denied')
									}
									const expiresAt = (yield* Clock.currentTimeMillis) + 60000
									yield* Ref.update(draft, current => ({
										...current,
										tokens: {
											...current.tokens,
											[row.hash]: {expiresAt, payload: {_tag: 'Delivered' as const, id, url: target.href}}
										}
									}))
									return AuthorizationStatus.make({_tag: 'Completed', url: target.href})
								})
							})
						)
					)
				}, rejected('Cannot complete the authorization request'))
				const grantTokens = Effect.fnUntraced(function* (
					grant: typeof Stored.cases.Refresh.Type,
					resources: PendingAuthorization['resources'],
					draft: Ref.Ref<AuthState>
				) {
					yield* allowed(grant.user, draft)
					// A queued iOS upload cannot refresh its bearer after the share sheet closes.
					const seconds = Boolean.match(Array.contains(resources, 'https://stash.mp281x.xyz'), {
						onFalse: () => 900,
						onTrue: () => 90_000
					})
					return HttpServerResponse.jsonUnsafe(
						{
							access_token: yield* mint(
								{_tag: 'Access', family: grant.family, resources, user: grant.user},
								seconds,
								draft
							),
							expires_in: seconds,
							refresh_token: yield* mint({...grant, _tag: 'Refresh'}, 30 * 86400, draft),
							scope: 'deslop',
							token_type: 'Bearer'
						},
						{headers: {'cache-control': 'no-store'}}
					)
				})
				const tokenResources = Effect.fnUntraced(function* (
					params: TokenParams,
					granted: PendingAuthorization['resources']
				) {
					if (params.resource === undefined) return granted
					if (!Array.every(params.resource, value => Array.contains(granted, value))) {
						return yield* AuthError.make({error: 'invalid_target', message: 'The resource was not authorized'})
					}
					return params.resource
				})

				yield* router.add(
					'GET',
					'/.well-known/oauth-authorization-server/api/auth',
					HttpServerResponse.jsonUnsafe({
						authorization_endpoint: `${issuer}/oauth2/authorize`,
						authorization_response_iss_parameter_supported: true,
						code_challenge_methods_supported: ['S256'],
						grant_types_supported: ['authorization_code', 'refresh_token'],
						issuer,
						registration_endpoint: `${issuer}/oauth2/register`,
						response_types_supported: ['code'],
						revocation_endpoint: `${issuer}/oauth2/revoke`,
						scopes_supported: ['deslop', 'offline_access'],
						token_endpoint: `${issuer}/oauth2/token`,
						token_endpoint_auth_methods_supported: ['none']
					})
				)
				yield* router.add(
					'POST',
					'/api/auth/oauth2/register',
					oauth(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaBodyJson(Registration),
								rejected('Invalid client registration')
							)
							if (!Array.every(params.redirect_uris, allowedRedirect)) {
								return yield* AuthError.make({message: 'Use a Codex, Claude Code, Stash, opm or Trips callback'})
							}
							return HttpServerResponse.jsonUnsafe(
								{
									client_id: yield* transact(draft =>
										Effect.gen(function* () {
											const token = yield* mint(
												{_tag: 'Client', name: params.client_name ?? 'Unknown client', redirects: params.redirect_uris},
												365 * 86400,
												draft
											)
											yield* Ref.update(draft, current => ({...current, tokens: newestClients(current.tokens)}))
											return token
										})
									),
									grant_types: ['authorization_code', 'refresh_token'],
									redirect_uris: params.redirect_uris,
									response_types: ['code'],
									token_endpoint_auth_method: 'none'
								},
								{status: 201}
							)
						})
					)
				)
				yield* router.add(
					'GET',
					'/api/auth/oauth2/authorize',
					oauth(
						pipe(
							transact(draft =>
								Effect.gen(function* () {
									const params = yield* pipe(
										HttpServerRequest.schemaSearchParams(AuthorizeParams),
										rejected('Invalid authorization request')
									)
									const registration = yield* load(params.client_id, draft)
									if (registration._tag !== 'Client' || !Array.contains(registration.redirects, params.redirect_uri)) {
										return yield* AuthError.make({
											error: 'invalid_client',
											message: 'The callback does not match the registered client'
										})
									}
									if (
										!Array.every(
											String.split(params.scope ?? 'deslop', ' '),
											scope => scope === 'deslop' || scope === 'offline_access'
										)
									) {
										return yield* AuthError.make({error: 'invalid_scope', message: 'Only Deslop access is supported'})
									}
									const now = yield* Clock.currentTimeMillis
									const id = Array.join(
										Array.map(Array.fromIterable(yield* random.randomBytes(8)), byte =>
											pipe(
												CODE_LETTERS,
												String.charAt(byte % CODE_LETTERS.length),
												Option.getOrElse(() => '')
											)
										),
										''
									)
									// Two live sign-ins never share a code; one in about 10^10 draws repeats one, and its app simply starts again.
									if (Option.isSome(yield* requestRow(id, draft))) {
										return yield* AuthError.make({message: 'Start the sign-in again'})
									}
									const token = yield* mint(
										{
											_tag: 'Request',
											challenge: params.code_challenge,
											clientId: params.client_id,
											clientName: registration.name ?? 'Unknown client',
											createdAt: now,
											decision: {_tag: 'Pending'},
											id,
											redirectUri: params.redirect_uri,
											resources: params.resource,
											state: params.state
										},
										240,
										draft
									)
									return HttpServerResponse.setCookieUnsafe(
										HttpServerResponse.redirect(`/?request=${id}`),
										`${REQUEST_COOKIE}${id}`,
										token,
										{...COOKIE, maxAge: '5 minutes'}
									)
								})
							),
							Effect.tap(() => PubSub.publish(changes, true))
						)
					)
				)
				yield* router.add(
					'POST',
					'/api/auth/oauth2/consent',
					oauth(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaBodyJson(ConsentParams),
								rejected('Invalid authorization response')
							)
							yield* respond(params, (yield* HttpServerRequest.HttpServerRequest).headers)
							return HttpServerResponse.empty()
						})
					)
				)
				yield* router.add(
					'POST',
					'/api/auth/oauth2/token',
					oauth(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaBodyUrlParams(TokenParams),
								rejected('Invalid token request')
							)
							return yield* transact(draft =>
								Effect.gen(function* () {
									if (params.grant_type === 'authorization_code') {
										const code = yield* load(params.code, draft)
										if (
											code._tag !== 'Code' ||
											code.clientId !== params.client_id ||
											code.redirectUri !== params.redirect_uri ||
											code.challenge !== (yield* hash(params.code_verifier))
										) {
											return yield* AuthError.make({
												error: 'invalid_grant',
												message: 'The authorization code or verifier is invalid'
											})
										}
										const resources = yield* tokenResources(params, code.resources)
										yield* remove(params.code, draft)
										return yield* grantTokens(
											{
												_tag: 'Refresh',
												clientId: code.clientId,
												family: Base64Url.encode(yield* random.randomBytes(32)),
												resources: code.resources,
												user: code.user
											},
											resources,
											draft
										)
									}
									const refresh = yield* load(params.refresh_token, draft)
									if (refresh._tag === 'UsedRefresh') {
										yield* revokeFamily(refresh.family, draft)
										return HttpServerResponse.jsonUnsafe(
											{error: 'invalid_grant', error_description: 'Sign in again'},
											{status: 400}
										)
									}
									if (refresh._tag !== 'Refresh' || refresh.clientId !== params.client_id) {
										return yield* AuthError.make({error: 'invalid_grant', message: 'The refresh token is invalid'})
									}
									const resources = yield* tokenResources(params, refresh.resources)
									const key = yield* hash(params.refresh_token)
									yield* Ref.update(draft, current => ({
										...current,
										tokens: pipe(
											Record.modify(current.tokens, key, entry => ({
												...entry,
												payload: {_tag: 'UsedRefresh' as const, clientId: refresh.clientId, family: refresh.family}
											})),
											Option.getOrElse(() => current.tokens)
										)
									}))
									return yield* grantTokens(refresh, resources, draft)
								})
							)
						})
					)
				)
				yield* router.add(
					'POST',
					'/api/auth/oauth2/revoke',
					oauth(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaBodyUrlParams(RevokeParams),
								rejected('Invalid revocation request')
							)
							return yield* transact(draft =>
								Effect.gen(function* () {
									const token = yield* Effect.result(load(params.token, draft))
									if (
										Result.isSuccess(token) &&
										(token.success._tag === 'Refresh' || token.success._tag === 'UsedRefresh') &&
										token.success.clientId === params.client_id
									) {
										yield* revokeFamily(token.success.family, draft)
									}
									return HttpServerResponse.empty()
								})
							)
						})
					)
				)
				yield* router.add(
					'GET',
					'/auth/session',
					Effect.gen(function* () {
						const user = yield* Effect.result(session((yield* HttpServerRequest.HttpServerRequest).headers))
						if (Result.isFailure(user)) return HttpServerResponse.empty({status: 401})
						return yield* HttpServerResponse.schemaJson(User)(user.success, {headers: {'cache-control': 'no-store'}})
					})
				)
				yield* router.add(
					'GET',
					'/auth/verify',
					Effect.gen(function* () {
						const params = yield* pipe(
							HttpServerRequest.schemaSearchParams(VerificationParams),
							rejected('Invalid resource')
						)
						const user = yield* Effect.result(
							access((yield* HttpServerRequest.HttpServerRequest).headers, params.resource)
						)
						if (Result.isFailure(user)) return HttpServerResponse.empty({status: 401})
						return yield* HttpServerResponse.schemaJson(User)(user.success, {headers: {'cache-control': 'no-store'}})
					})
				)

				yield* router.add(
					'GET',
					'/auth/github',
					oauth(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaSearchParams(SignInParams),
								rejected('Invalid sign-in request')
							)
							if (params.request !== undefined) {
								yield* receiver(params.request, (yield* HttpServerRequest.HttpServerRequest).headers)
							}
							const verifier = Base64Url.encode(yield* random.randomBytes(32))
							const loginState = yield* transact(draft => mint({_tag: 'Login', ...params, verifier}, 600, draft))
							const authorize = new URL('https://github.com/login/oauth/authorize')
							authorize.search = UrlParams.toString(
								UrlParams.fromInput({
									client_id: provider.clientId,
									code_challenge: yield* hash(verifier),
									code_challenge_method: 'S256',
									redirect_uri: `${url}/auth/github/callback`,
									state: loginState
								})
							)
							return HttpServerResponse.setCookieUnsafe(
								HttpServerResponse.redirect(authorize.href),
								LOGIN_COOKIE,
								loginState,
								{...COOKIE, maxAge: '10 minutes'}
							)
						})
					)
				)
				yield* router.add(
					'GET',
					'/auth/github/callback',
					pipe(
						Effect.gen(function* () {
							const params = yield* pipe(
								HttpServerRequest.schemaSearchParams(CallbackParams),
								rejected('GitHub sent no code')
							)
							if ((yield* HttpServerRequest.HttpServerRequest).cookies[LOGIN_COOKIE] !== params.state) {
								return yield* AuthError.make({message: 'The sign-in state does not match'})
							}
							const flow = yield* transact(draft =>
								Effect.gen(function* () {
									const stored = yield* load(params.state, draft)
									if (stored._tag !== 'Login') return yield* AuthError.make({message: 'The sign-in expired'})
									yield* remove(params.state, draft)
									return stored
								})
							)
							const token = yield* pipe(
								HttpClientRequest.post('https://github.com/login/oauth/access_token'),
								HttpClientRequest.acceptJson,
								HttpClientRequest.bodyUrlParams({
									client_id: provider.clientId,
									client_secret: Redacted.value(provider.secret),
									code: params.code,
									code_verifier: flow.verifier,
									redirect_uri: `${url}/auth/github/callback`
								}),
								request => client.execute(request),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubToken)),
								Effect.timeout('10 seconds')
							)
							const github = yield* pipe(
								HttpClientRequest.get('https://api.github.com/user'),
								HttpClientRequest.bearerToken(token.access_token),
								HttpClientRequest.setHeaders({accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}),
								request => client.execute(request),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
								Effect.timeout('10 seconds')
							)
							const signedInToken = yield* register(github)
							return HttpServerResponse.setCookieUnsafe(
								HttpServerResponse.expireCookieUnsafe(
									HttpServerResponse.redirect(
										pipe(
											UrlParams.toString(UrlParams.fromInput({code: flow.code, request: flow.request})),
											Option.liftPredicate(String.isNonEmpty),
											Option.match({
												onNone: () =>
													Option.getOrElse(
														Option.filter(Option.fromUndefinedOr(flow.next), next => returnable(next, url)),
														() => '/'
													),
												onSome: search => `/?${search}`
											})
										)
									),
									LOGIN_COOKIE,
									COOKIE
								),
								SESSION_COOKIE,
								signedInToken,
								{
									...COOKIE,
									domain: pipe(new URL(url).hostname, String.split('.'), Array.drop(1), Array.join('.')),
									maxAge: '365 days'
								}
							)
						}),
						Effect.catch(
							Effect.fnUntraced(function* (cause) {
								yield* Effect.logWarning('GitHub sign-in failed', cause)
								return HttpServerResponse.expireCookieUnsafe(
									HttpServerResponse.redirect(
										`/?${UrlParams.toString(UrlParams.fromInput({error: 'github', request: undefined}))}`
									),
									LOGIN_COOKIE,
									COOKIE
								)
							})
						)
					)
				)
				yield* router.add(
					'POST',
					'/auth/sign-out',
					oauth(
						Effect.gen(function* () {
							yield* sameOrigin
							const token = (yield* HttpServerRequest.HttpServerRequest).cookies[SESSION_COOKIE] ?? ''
							yield* transact(draft => remove(token, draft))
							// The browser's other open pages watch the account and show it signed out.
							yield* PubSub.publish(changes, true)
							return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.empty(), SESSION_COOKIE, {
								...COOKIE,
								domain: pipe(new URL(url).hostname, String.split('.'), Array.drop(1), Array.join('.'))
							})
						})
					)
				)
				return pipe(
					Auth.makeContext(
						Auth.of({
							access,
							user: Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
								return yield* session(headers)
							})
						})
					),
					Context.add(
						Authorizations,
						Authorizations.of({
							account: headers => watch(account(headers), () => Infinity),
							admit,
							answer,
							listPeople,
							lookup: (code, headers) =>
								watch(lookup(code, headers), found =>
									Option.match(found, {onNone: () => Infinity, onSome: request => request.expiresAt})
								),
							people: user => watch(listPeople(user), () => Infinity),
							remove: removePerson,
							wait: (id, headers) =>
								pipe(
									watch(receive(id, headers), status =>
										pipe(
											Match.value(status),
											Match.tag('Waiting', value => value.request.expiresAt),
											Match.orElse(() => Infinity)
										)
									),
									Stream.takeUntil(status => status._tag !== 'Waiting')
								)
						})
					)
				)
			})
		),
		Layer.provide(
			Layer.unwrap(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem
					const path = yield* Path.Path
					const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth')
					yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
					return layerKeyValueStore(directory)
				})
			)
		)
	)
}
