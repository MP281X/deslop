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
	Match,
	Number,
	Option,
	Order,
	Path,
	Predicate,
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

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	UrlParams
} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AuthError, Resource, User} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import {layerKeyValueStore} from '@deslop/runtime/server'

import {
	allowedRedirect,
	cookieDomain,
	given,
	matchingRedirect,
	returnable,
	typedCode
} from '#services/authorizations/lib/utils.ts'
import {waitForChange} from '#services/authorizations/lib/watch.ts'
import type {
	AdmitParams,
	PendingAuthorization,
	Role,
	MemberRow,
	SignedInApp,
	Stored
} from '#services/authorizations/schema.ts'
import {
	Account,
	AuthState,
	AuthorizationStatus,
	AuthorizeClient,
	AuthorizeParams,
	CallbackParams,
	ConsentParams,
	GitHubToken,
	GitHubUser,
	LoginState,
	Person,
	Registration,
	RevokeParams,
	SignInParams,
	TokenGrant,
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
const REFRESH_SECONDS = 30 * 86_400

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

// A cancelled or failed GitHub step returns to the waiting sign-in, so the page can start it again.
function githubFailed(cause: unknown, flow: Option.Option<typeof Stored.cases.Login.Type>) {
	return Effect.as(
		Effect.logWarning('GitHub sign-in failed', cause),
		HttpServerResponse.expireCookieUnsafe(
			HttpServerResponse.redirect(
				`/?${UrlParams.toString(
					UrlParams.fromInput({
						error: 'github',
						...pipe(
							flow,
							Option.map(Struct.pick(['code', 'request'])),
							Option.getOrElse(() => ({}))
						)
					})
				)}`
			),
			LOGIN_COOKIE,
			COOKIE
		)
	)
}

// The clients a waiting sign-in, an unredeemed code or a live refresh token still belongs to.
function clientsInUse(tokens: AuthState['tokens']) {
	return Array.dedupe(
		Array.flatMap(Record.values(tokens), entry => {
			if (entry.payload._tag === 'Request' || entry.payload._tag === 'Code' || entry.payload._tag === 'Refresh') {
				return [entry.payload.clientId]
			}
			return []
		})
	)
}

// Anyone can register a client, so only the newest stay besides those in use; an agent whose idle client was dropped registers again.
function newestClients(tokens: AuthState['tokens'], inUse: HashSet.HashSet<string>) {
	const kept = pipe(
		Record.toEntries(tokens),
		Array.filter(pair => pair[1].payload._tag === 'Client' && !HashSet.has(inUse, pair[0])),
		Array.sort(Order.flip(Order.mapInput(Order.Number, (pair: [string, {expiresAt: number}]) => pair[1].expiresAt))),
		Array.take(200),
		Array.map(pair => pair[0]),
		HashSet.fromIterable
	)
	return Record.filter(
		tokens,
		(entry, key) => entry.payload._tag !== 'Client' || HashSet.has(kept, key) || HashSet.has(inUse, key)
	)
}

// The address the client connects from: Traefik appends it as the last X-Forwarded-For entry, earlier ones are the client's word.
function clientAddress(request: HttpServerRequest.HttpServerRequest) {
	return pipe(
		Headers.get(request.headers, 'x-forwarded-for'),
		Option.flatMap(forwarded => Array.last(String.split(',')(forwarded))),
		Option.map(String.trim),
		Option.filter(String.isNonEmpty),
		Option.orElse(() => request.remoteAddress)
	)
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
						entry.payload._tag === 'UsedCode' ||
						entry.payload._tag === 'UsedRefresh') &&
					entry.payload.family === family
				)
		)
	}))
}

// A replayed grant still changes state, revoking its family, so it answers instead of failing the transaction.
function invalidGrant(message: string) {
	return HttpServerResponse.jsonUnsafe(
		{error: 'invalid_grant', error_description: message},
		{headers: {'cache-control': 'no-store'}, status: 400}
	)
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
		readonly apps: (user: User) => Stream.Stream<SignedInApp[], AuthError>
		readonly admin: (user: User) => Effect.Effect<void, AuthError>
		readonly delegate: (headers: Headers.Headers, resource: Resource) => Effect.Effect<string, AuthError>
		readonly disconnect: (family: string, user: User) => Effect.Effect<void, AuthError>
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
				const random = yield* SecureRandom.SecureRandom
				const digest = yield* Digest.Digest
				const changes = yield* PubSub.sliding<true>(1)
				const router = yield* HttpRouter.HttpRouter
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const issuer = `${AUTH_URL}/api/auth`
				const provider = yield* Config.all({
					admins: Config.Array(Schema.String, 'GITHUB_ADMINS'),
					clientId: Config.String('GITHUB_CLIENT_ID'),
					secret: Config.Redacted('GITHUB_CLIENT_SECRET')
				})
				const hash = Effect.fnUntraced(function* (value: string) {
					return Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(value)))
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
				// A redeemed grant keeps its expiry as a marker of its family, so its replay is caught.
				const retire = Effect.fnUntraced(function* (
					token: string,
					payload: typeof Stored.cases.UsedCode.Type | typeof Stored.cases.UsedRefresh.Type,
					draft: Ref.Ref<AuthState>
				) {
					const key = yield* hash(token)
					yield* Ref.update(draft, current => ({
						...current,
						tokens: pipe(
							Record.modify(current.tokens, key, entry => ({...entry, payload})),
							Option.getOrElse(() => current.tokens)
						)
					}))
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
					// RFC 9110 auth schemes are case-insensitive and may be followed by more than one space.
					const stored = yield* pipe(
						Option.flatMapNullishOr(
							String.match(/^bearer +(?<token>\S+) *$/iu)(headers['authorization'] ?? ''),
							found => found.groups?.['token']
						),
						Effect.fromOption,
						Effect.flatMap(token => load(token))
					)
					if (stored._tag !== 'Access' || !Array.some(stored.resources, value => value === resource)) {
						return yield* AuthError.make({message: 'The token is not valid for this app'})
					}
					return yield* allowed(stored.user)
				}, rejected('Sign in first'))
				const checkOrigin = Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (headers['origin'] !== AUTH_URL) {
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
									yield* waitForChange(subscription, previous)
									const value = yield* read
									return [value, Option.some(expires(value))] as const
								})
							)
						})
					)
				}
				// A waiting sign-in is read only by its code, in any case and with or without the dash, so no account lists anyone else's.
				const pendingRequest = Effect.fnUntraced(function* (typed: string) {
					return Option.flatMap(yield* requestRow(typedCode(typed)), row => {
						if (row.payload._tag !== 'Request' || row.payload.decision._tag !== 'Pending') return Option.none()
						return Option.some(publicRequest(row.payload, row.expiresAt))
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
							AuthError.make({
								cause,
								message:
									'No waiting sign-in has this code: it is mistyped, already answered or expired after 4 minutes. Read the code again from the page that is still waiting; start a new sign-in only if none is.'
							})
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
							return yield* mint({_tag: 'Session', user}, 365 * 86_400, draft)
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
				const clientName = Effect.fnUntraced(function* (clientId: string, tokens: AuthState['tokens']) {
					return pipe(
						Record.get(tokens, yield* hash(clientId)),
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
					draft: Ref.Ref<AuthState>
				) {
					if (Predicate.isUndefined(grant.address)) return
					const current = yield* Ref.get(draft)
					const name = yield* clientName(grant.clientId, current.tokens)
					const sameApps = Array.makeEquivalence(String.Equivalence)
					const replaced = yield* Effect.filter(
						Array.flatMap(Record.values(current.tokens), entry => {
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
						earlier => Effect.map(clientName(earlier.clientId, current.tokens), earlierName => earlierName === name)
					)
					yield* Effect.forEach(
						Array.dedupe(Array.map(replaced, earlier => earlier.family)),
						family => revokeFamily(family, draft),
						{concurrency: 1, discard: true}
					)
				})
				// Each app sign-in is one refresh-token family whose live token was minted at its last refresh, newest first.
				const listApps = Effect.fn('Authorizations.listApps')(function* (user: User) {
					const now = yield* Clock.currentTimeMillis
					const current = yield* Ref.get(state)
					const apps = yield* Effect.forEach(
						Array.flatMap(Record.values(current.tokens), entry => {
							if (entry.expiresAt <= now || entry.payload._tag !== 'Refresh' || entry.payload.user.id !== user.id) {
								return []
							}
							return [{expiresAt: entry.expiresAt, grant: entry.payload}]
						}),
						Effect.fnUntraced(function* (row) {
							return {
								clientName: yield* clientName(row.grant.clientId, current.tokens),
								family: row.grant.family,
								lastActive: row.expiresAt - REFRESH_SECONDS * 1000,
								resources: row.grant.resources
							} satisfies SignedInApp
						}),
						{concurrency: 'unbounded'}
					)
					return Array.sort(apps, Order.flip(Order.mapInput(Order.Number, (app: SignedInApp) => app.lastActive)))
				}, rejected('Cannot read the signed-in apps'))
				const disconnect = Effect.fn('Authorizations.disconnect')(function* (family: string, user: User) {
					yield* transact(draft =>
						Effect.gen(function* () {
							const owned = Array.some(
								Record.values((yield* Ref.get(draft)).tokens),
								entry =>
									entry.payload._tag === 'Refresh' &&
									entry.payload.family === family &&
									entry.payload.user.id === user.id
							)
							if (!owned) return yield* AuthError.make({message: 'This app is already disconnected'})
							yield* revokeFamily(family, draft)
						})
					)
					yield* PubSub.publish(changes, true)
				}, rejected('Cannot disconnect this app'))
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
									if (row.payload.state !== undefined) target.searchParams.set('state', row.payload.state)
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
									const expiresAt = (yield* Clock.currentTimeMillis) + 60_000
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
							refresh_token: yield* mint({...grant, _tag: 'Refresh'}, REFRESH_SECONDS, draft),
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
				// A checked authorization request becomes a waiting sign-in under a fresh code, in this browser's cookie.
				const waitingSignIn = Effect.fnUntraced(function* (
					asked: AuthorizeClient,
					registration: typeof Stored.cases.Client.Type,
					redirectUri: string,
					draft: Ref.Ref<AuthState>
				) {
					const params = yield* pipe(
						HttpServerRequest.schemaSearchParams(AuthorizeParams),
						rejected('Invalid authorization request')
					)
					if (Option.isNone(given(params.response_type))) {
						return yield* AuthError.make({message: 'Send response_type=code'})
					}
					if (params.response_type !== 'code') {
						return yield* AuthError.make({
							error: 'unsupported_response_type',
							message: 'Only response_type=code is supported'
						})
					}
					if (params.code_challenge === undefined || params.code_challenge_method !== 'S256') {
						return yield* AuthError.make({message: 'Send a PKCE code_challenge with code_challenge_method=S256'})
					}
					if (
						!Array.every(
							Array.filter(String.split(params.scope ?? '', ' '), String.isNonEmpty),
							scope => scope === 'deslop' || scope === 'offline_access'
						)
					) {
						return yield* AuthError.make({error: 'invalid_scope', message: 'Only the deslop scope is supported'})
					}
					const resources = yield* pipe(
						Schema.decodeUnknownEffect(Schema.NonEmptyArray(Resource))(params.resource ?? []),
						Effect.mapError(cause =>
							AuthError.make({cause, error: 'invalid_target', message: 'Name a Deslop app with the resource parameter'})
						)
					)
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
						return yield* AuthError.make({error: 'temporarily_unavailable', message: 'Start the sign-in again'})
					}
					const token = yield* mint(
						{
							_tag: 'Request',
							challenge: params.code_challenge,
							clientId: asked.client_id,
							clientName: registration.name ?? 'Unknown client',
							createdAt: yield* Clock.currentTimeMillis,
							decision: {_tag: 'Pending'},
							id,
							redirectUri,
							resources,
							...Option.match(given(asked.state), {onNone: () => ({}), onSome: sent => ({state: sent})})
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
								Effect.mapError(cause =>
									AuthError.make({
										cause,
										error: 'invalid_client_metadata',
										message: 'Send up to 4 redirect_uris of at most 200 characters and a client_name of at most 100'
									})
								)
							)
							if (!Array.every(params.redirect_uris, allowedRedirect)) {
								return yield* AuthError.make({
									error: 'invalid_redirect_uri',
									message: 'Use a loopback http://127.0.0.1 callback or a Stash, opm or Trips app callback'
								})
							}
							const name = params.client_name ?? 'Unknown client'
							return HttpServerResponse.jsonUnsafe(
								{
									client_id: yield* transact(draft =>
										Effect.gen(function* () {
											const token = yield* mint(
												{_tag: 'Client', name, redirects: params.redirect_uris},
												365 * 86_400,
												draft
											)
											const inUse = HashSet.fromIterable(
												yield* Effect.forEach(clientsInUse((yield* Ref.get(draft)).tokens), hash, {
													concurrency: 'unbounded'
												})
											)
											yield* Ref.update(draft, current => ({...current, tokens: newestClients(current.tokens, inUse)}))
											return token
										})
									),
									client_name: name,
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
									// Until the client and its callback check out, an error stays on this page: RFC 9700 §4.11 forbids redirecting it.
									const asked = yield* pipe(
										HttpServerRequest.schemaSearchParams(AuthorizeClient),
										rejected('The authorization request names no client_id')
									)
									const unregistered = AuthError.make({
										error: 'invalid_client',
										message: 'This client is not registered; start the sign-in again in the app'
									})
									const registration = yield* Effect.mapError(load(asked.client_id, draft), () => unregistered)
									if (registration._tag !== 'Client') return yield* unregistered
									const redirectUri = yield* pipe(
										matchingRedirect(registration, given(asked.redirect_uri)),
										Effect.fromOption,
										Effect.mapError(cause =>
											AuthError.make({cause, message: 'The callback does not match the registered client'})
										)
									)
									return yield* pipe(
										waitingSignIn(asked, registration, redirectUri, draft),
										Effect.catchIf(Schema.is(AuthError), failure => {
											const target = new URL(redirectUri)
											target.searchParams.set('error', failure.error ?? 'invalid_request')
											target.searchParams.set('error_description', failure.message)
											Option.map(given(asked.state), sent => target.searchParams.set('state', sent))
											target.searchParams.set('iss', issuer)
											return Effect.succeed(HttpServerResponse.redirect(target.href))
										})
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
							const grant = yield* pipe(
								HttpServerRequest.schemaBodyUrlParams(TokenGrant),
								rejected('Send a grant_type')
							)
							if (grant.grant_type !== 'authorization_code' && grant.grant_type !== 'refresh_token') {
								return yield* AuthError.make({
									error: 'unsupported_grant_type',
									message: 'Use grant_type authorization_code or refresh_token'
								})
							}
							const params = yield* pipe(
								HttpServerRequest.schemaBodyUrlParams(TokenParams),
								rejected('Invalid token request')
							)
							const address = clientAddress(yield* HttpServerRequest.HttpServerRequest)
							const response = yield* transact(draft =>
								Effect.gen(function* () {
									if (params.grant_type === 'authorization_code') {
										const code = yield* load(params.code, draft)
										if (code._tag === 'UsedCode') {
											yield* revokeFamily(code.family, draft)
											return invalidGrant(
												'This authorization code was already used, so the tokens it gave are revoked; sign in again'
											)
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
										const signIn = {
											_tag: 'Refresh' as const,
											clientId: code.clientId,
											family,
											resources: code.resources,
											user: code.user,
											...Option.match(address, {onNone: () => ({}), onSome: value => ({address: value})})
										}
										yield* replaceSignIns(signIn, draft)
										return yield* grantTokens(signIn, resources, draft)
									}
									const refresh = yield* load(params.refresh_token, draft)
									if (refresh._tag === 'UsedRefresh') {
										yield* revokeFamily(refresh.family, draft)
										return invalidGrant('This refresh token was already used, so its sign-in is revoked; sign in again')
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
									return yield* grantTokens(refresh, resources, draft)
								})
							)
							yield* PubSub.publish(changes, true)
							return response
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
							yield* transact(draft =>
								Effect.gen(function* () {
									const token = yield* Effect.result(load(params.token, draft))
									if (
										Result.isSuccess(token) &&
										(token.success._tag === 'Refresh' || token.success._tag === 'UsedRefresh') &&
										token.success.clientId === params.client_id
									) {
										yield* revokeFamily(token.success.family, draft)
									}
								})
							)
							yield* PubSub.publish(changes, true)
							return HttpServerResponse.empty()
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
									redirect_uri: `${AUTH_URL}/auth/github/callback`,
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
				// The sign-in GitHub's callback belongs to, read once.
				const takeLogin = Effect.fnUntraced(function* (loginState: string) {
					return yield* transact(draft =>
						Effect.gen(function* () {
							const stored = yield* load(loginState, draft)
							if (stored._tag !== 'Login') return yield* AuthError.make({message: 'The sign-in expired'})
							yield* remove(loginState, draft)
							return stored
						})
					)
				})
				const signIn = Effect.fnUntraced(function* (code: string, flow: typeof Stored.cases.Login.Type) {
					const token = yield* pipe(
						HttpClientRequest.post('https://github.com/login/oauth/access_token'),
						HttpClientRequest.acceptJson,
						HttpClientRequest.bodyUrlParams({
							client_id: provider.clientId,
							client_secret: Redacted.value(provider.secret),
							code,
							code_verifier: flow.verifier,
							redirect_uri: `${AUTH_URL}/auth/github/callback`
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
												Option.filter(Option.fromUndefinedOr(flow.next), next => returnable(next, AUTH_URL)),
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
						{...COOKIE, domain: cookieDomain(AUTH_URL), maxAge: '365 days'}
					)
				})
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
							const flow = yield* takeLogin(params.state)
							return yield* Effect.catch(signIn(params.code, flow), cause => githubFailed(cause, Option.some(flow)))
						}),
						// A cancelled GitHub step sends no code, only the state of the sign-in it belonged to.
						Effect.catch(cause =>
							Effect.flatMap(
								Effect.option(
									Effect.flatMap(HttpServerRequest.schemaSearchParams(LoginState), found => takeLogin(found.state))
								),
								flow => githubFailed(cause, flow)
							)
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
								domain: cookieDomain(AUTH_URL)
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
							admin,
							admit,
							answer,
							apps: user =>
								watch(listApps(user), apps =>
									pipe(
										Array.map(apps, app => app.lastActive + REFRESH_SECONDS * 1000),
										Array.reduce(Infinity, Number.min)
									)
								),
							delegate: Effect.fn('Authorizations.delegate')(function* (headers: Headers.Headers, resource: Resource) {
								yield* access(headers, 'https://auth.mp281x.xyz/mcp')
								const bearer = headers['authorization'] ?? ''
								const token = String.trim(String.replace(/^bearer +/iu, '')(bearer))
								return yield* transact(draft =>
									Effect.gen(function* () {
										const source = yield* load(token, draft)
										if (source._tag !== 'Access') return yield* AuthError.make({message: 'Sign in first'})
										return yield* mint({...source, resources: [resource]}, 60, draft)
									})
								)
							}, rejected('Cannot authorize the upstream MCP')),
							disconnect,
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
