import {SqliteClient} from '@effect/sql-sqlite-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Crypto,
	Effect,
	FileSystem,
	Layer,
	Match,
	Number,
	Option,
	Order,
	Path,
	PubSub,
	Redacted,
	Result,
	Schema,
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

import {AuthError, User} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {AUTH_URL} from '@deslop/runtime/auth/utils'

import type {AdmitParams, PendingAuthorization, Role} from '#services/authorizations/schema.ts'
import {
	Account,
	AuthorizationRow,
	AuthorizationStatus,
	AuthorizeParams,
	CallbackParams,
	ConsentParams,
	GitHubToken,
	GitHubUser,
	MemberRow,
	Person,
	Registration,
	RevokeParams,
	SignInParams,
	Stored,
	StoredRow,
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
			['stash://auth/callback', 'stash-dev://auth/callback', 'opm://auth/callback', 'opm-dev://auth/callback'],
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
				const sql = yield* SqliteClient.SqliteClient
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
				yield* sql`CREATE TABLE IF NOT EXISTS auth_state (hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)`
				yield* sql`CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL, status TEXT NOT NULL, since INTEGER NOT NULL)`
				// A sign-in still waiting under the previous release's id has no code to type, so its page asks to start again.
				yield* sql`DELETE FROM auth_state WHERE json_extract(payload, '$._tag') = 'Request' AND json_extract(payload, '$.id') GLOB '*[^A-Z]*'`
				const hash = Effect.fnUntraced(function* (value: string) {
					return Base64Url.encode(yield* random.digest('SHA-256', new TextEncoder().encode(value)))
				})
				const save = Effect.fnUntraced(function* (state: Stored, seconds: number) {
					const token = Base64Url.encode(yield* random.randomBytes(32))
					const now = yield* Clock.currentTimeMillis
					yield* sql`DELETE FROM auth_state WHERE expires_at <= ${now}`
					yield* sql`INSERT INTO auth_state (hash, payload, expires_at) VALUES (${yield* hash(token)}, ${yield* Schema.encodeEffect(Schema.fromJsonString(Stored))(state)}, ${now + seconds * 1000})`
					return token
				})
				const load = Effect.fnUntraced(function* (token: string) {
					const row = yield* pipe(
						Array.head(
							yield* sql`SELECT payload FROM auth_state WHERE hash = ${yield* hash(token)} AND expires_at > ${yield* Clock.currentTimeMillis}`
						),
						Effect.fromOption,
						Effect.flatMap(Schema.decodeUnknownEffect(StoredRow)),
						Effect.mapError(cause =>
							AuthError.make({cause, error: 'invalid_grant', message: 'The authorization expired. Sign in again.'})
						)
					)
					return yield* Schema.decodeEffect(Schema.fromJsonString(Stored))(row.payload)
				})
				const remove = Effect.fnUntraced(function* (token: string) {
					yield* sql`DELETE FROM auth_state WHERE hash = ${yield* hash(token)}`
				})
				function isAdmin(id: string) {
					return Array.contains(provider.admins, String.replace('github:', '')(id))
				}
				const members = pipe(
					sql`SELECT id, name, full_name AS "fullName", status, since FROM members ORDER BY since DESC, rowid DESC`,
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow)))
				)
				const member = Effect.fnUntraced(function* (id: string) {
					return yield* pipe(
						sql`SELECT id, name, full_name AS "fullName", status, since FROM members WHERE id = ${id}`,
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
						Effect.map(Array.head)
					)
				})
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
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser))
							)
							yield* sql`INSERT INTO members (id, name, full_name, status, since) VALUES (${`github:${github.id}`}, ${github.login}, ${github.name ?? ''}, 'Allowed', ${yield* Clock.currentTimeMillis}) ON CONFLICT(id) DO NOTHING`
							yield* PubSub.publish(changes, true)
						}),
						{concurrency: 1, discard: true}
					),
					Effect.ignore({log: 'Warn', message: 'The admins’ GitHub profiles could not be read'}),
					Effect.forkScoped
				)
				const roleOf = Effect.fnUntraced(function* (user: User) {
					if (isAdmin(user.id)) return 'Admin' as const
					return Option.match(yield* member(user.id), {
						onNone: () => 'Waiting' as const,
						onSome: row => personOf(row).role
					})
				}, rejected('Cannot read the account'))
				const allowed = Effect.fnUntraced(function* (user: User) {
					if ((yield* roleOf(user)) === 'Waiting') {
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
				const requestRow = Effect.fnUntraced(function* (id: string) {
					return yield* pipe(
						sql`SELECT hash, payload, expires_at AS "expiresAt" FROM auth_state WHERE json_extract(payload, '$.id') = ${id} AND expires_at > ${yield* Clock.currentTimeMillis}`,
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AuthorizationRow))),
						Effect.map(Array.head)
					)
				})
				const requestState = Effect.fnUntraced(function* (id: string) {
					const row = yield* Effect.fromOption(yield* requestRow(id))
					const stored = yield* Schema.decodeEffect(Schema.fromJsonString(Stored))(row.payload)
					if (stored._tag !== 'Request') return yield* AuthError.make({message: 'The authorization request expired'})
					return stored
				}, rejected('The authorization request expired'))
				const receiver = Effect.fnUntraced(function* (id: string, headers: Headers.Headers) {
					const token = Cookies.parseHeader(headers['cookie'] ?? '')[`${REQUEST_COOKIE}${id}`]
					if (token === undefined) {
						return yield* AuthError.make({message: 'Open the authorization link again'})
					}
					return yield* Option.match(yield* requestRow(id), {
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
							const stored = yield* Schema.decodeEffect(Schema.fromJsonString(Stored))(row.payload)
							if (stored._tag !== 'Request' || stored.decision._tag !== 'Pending') return Option.none()
							return Option.some(publicRequest(stored, row.expiresAt))
						})
					})
				})
				const lookup = Effect.fnUntraced(function* (code: string, headers: Headers.Headers) {
					yield* session(headers)
					return yield* pendingRequest(code)
				}, rejected('Cannot read the sign-in'))
				const decide = Effect.fnUntraced(function* (params: ConsentParams, user: User) {
					yield* sql.withTransaction(
						Effect.gen(function* () {
							const request = yield* requestState(params.request)
							if (request.decision._tag !== 'Pending') {
								return yield* AuthError.make({message: 'This authorization has already been answered'})
							}
							yield* sql`UPDATE auth_state SET payload = ${yield* Schema.encodeEffect(Schema.fromJsonString(Stored))({
								...request,
								decision: Boolean.match(params.accept, {
									onFalse: () => ({_tag: 'Denied' as const}),
									onTrue: () => ({_tag: 'Approved' as const, user})
								})
							})} WHERE json_extract(payload, '$.id') = ${params.request}`
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
					const token = yield* sql.withTransaction(
						Effect.andThen(
							sql`INSERT INTO members (id, name, full_name, status, since) VALUES (${user.id}, ${user.name}, ${github.name ?? ''}, ${status}, ${yield* Clock.currentTimeMillis}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, full_name = excluded.full_name`,
							save({_tag: 'Session', user}, 365 * 86400)
						)
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
				// Removing an account signs it out everywhere: its session, its app tokens and any sign-in it approved but did not deliver.
				const forget = Effect.fnUntraced(function* (id: string) {
					yield* sql`DELETE FROM members WHERE id = ${id}`
					yield* sql`DELETE FROM auth_state WHERE json_extract(payload, '$.user.id') = ${id} OR json_extract(payload, '$.decision.user.id') = ${id}`
				})
				// Each answer reads and changes the account in one transaction, so two answers to the same account cannot both apply.
				const admit = Effect.fn('Authorizations.admit')(function* (params: AdmitParams, user: User) {
					yield* admin(user)
					const person = yield* sql.withTransaction(
						Effect.gen(function* () {
							const found = personOf(yield* Effect.fromOption(yield* member(params.id)))
							if (found.role !== 'Waiting') {
								return yield* AuthError.make({message: 'This account is not asking for access'})
							}
							if (!params.allow) {
								yield* forget(params.id)
								return found
							}
							const now = yield* Clock.currentTimeMillis
							yield* sql`UPDATE members SET status = 'Allowed', since = ${now} WHERE id = ${params.id}`
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
					const person = yield* sql.withTransaction(
						Effect.gen(function* () {
							const found = personOf(yield* Effect.fromOption(yield* member(id)))
							yield* forget(id)
							return found
						})
					)
					yield* PubSub.publish(changes, true)
					return person
				}, rejected('Cannot remove this account'))
				const receive = Effect.fnUntraced(function* (id: string, headers: Headers.Headers) {
					return yield* sql.withTransaction(
						Effect.flatMap(receiver(id, headers), result =>
							Option.match(result, {
								onNone: () => Effect.succeed(AuthorizationStatus.make({_tag: 'Expired'})),
								onSome: Effect.fnUntraced(function* (row) {
									const request = yield* Schema.decodeEffect(Schema.fromJsonString(Stored))(row.payload)
									if (request._tag === 'Delivered') {
										return AuthorizationStatus.make({_tag: 'Completed', url: request.url})
									}
									if (request._tag !== 'Request') {
										return yield* AuthError.make({message: 'Invalid authorization request'})
									}
									if (request.decision._tag === 'Pending') {
										return AuthorizationStatus.make({_tag: 'Waiting', request: publicRequest(request, row.expiresAt)})
									}
									const target = new URL(request.redirectUri)
									target.searchParams.set('state', request.state)
									target.searchParams.set('iss', issuer)
									if (request.decision._tag === 'Approved') {
										target.searchParams.set(
											'code',
											yield* save(
												{
													...pipe(request, Struct.pick(['challenge', 'clientId', 'redirectUri', 'resources', 'state'])),
													_tag: 'Code',
													user: request.decision.user
												},
												60
											)
										)
									} else {
										target.searchParams.set('error', 'access_denied')
									}
									yield* sql`UPDATE auth_state SET payload = ${yield* Schema.encodeEffect(Schema.fromJsonString(Stored))({_tag: 'Delivered', id, url: target.href})}, expires_at = ${yield* Clock.currentTimeMillis} + 60000 WHERE hash = ${row.hash}`
									return AuthorizationStatus.make({_tag: 'Completed', url: target.href})
								})
							})
						)
					)
				}, rejected('Cannot complete the authorization request'))
				const grantTokens = Effect.fnUntraced(function* (
					grant: typeof Stored.cases.Refresh.Type,
					resources: PendingAuthorization['resources']
				) {
					yield* allowed(grant.user)
					// A queued iOS upload cannot refresh its bearer after the share sheet closes.
					const seconds = Boolean.match(Array.contains(resources, 'https://stash.mp281x.xyz'), {
						onFalse: () => 900,
						onTrue: () => 90_000
					})
					return HttpServerResponse.jsonUnsafe(
						{
							access_token: yield* save({_tag: 'Access', family: grant.family, resources, user: grant.user}, seconds),
							expires_in: seconds,
							refresh_token: yield* save({...grant, _tag: 'Refresh'}, 30 * 86400),
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
								return yield* AuthError.make({message: 'Use a Codex, Claude Code, Stash or opm callback'})
							}
							return HttpServerResponse.jsonUnsafe(
								{
									client_id: yield* save(
										{_tag: 'Client', name: params.client_name ?? 'Unknown client', redirects: params.redirect_uris},
										365 * 86400
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
							sql.withTransaction(
								Effect.gen(function* () {
									const params = yield* pipe(
										HttpServerRequest.schemaSearchParams(AuthorizeParams),
										rejected('Invalid authorization request')
									)
									const registration = yield* load(params.client_id)
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
									if (Option.isSome(yield* requestRow(id))) {
										return yield* AuthError.make({message: 'Start the sign-in again'})
									}
									const token = yield* save(
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
										240
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
							return yield* sql.withTransaction(
								Effect.gen(function* () {
									if (params.grant_type === 'authorization_code') {
										const code = yield* load(params.code)
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
										yield* remove(params.code)
										return yield* grantTokens(
											{
												_tag: 'Refresh',
												clientId: code.clientId,
												family: Base64Url.encode(yield* random.randomBytes(32)),
												resources: code.resources,
												user: code.user
											},
											resources
										)
									}
									const refresh = yield* load(params.refresh_token)
									if (refresh._tag === 'UsedRefresh') {
										yield* sql`DELETE FROM auth_state WHERE json_extract(payload, '$.family') = ${refresh.family}`
										return HttpServerResponse.jsonUnsafe(
											{error: 'invalid_grant', error_description: 'Sign in again'},
											{status: 400}
										)
									}
									if (refresh._tag !== 'Refresh' || refresh.clientId !== params.client_id) {
										return yield* AuthError.make({error: 'invalid_grant', message: 'The refresh token is invalid'})
									}
									const resources = yield* tokenResources(params, refresh.resources)
									yield* sql`UPDATE auth_state SET payload = ${yield* Schema.encodeEffect(Schema.fromJsonString(Stored))({_tag: 'UsedRefresh', clientId: refresh.clientId, family: refresh.family})} WHERE hash = ${yield* hash(params.refresh_token)}`
									return yield* grantTokens(refresh, resources)
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
							const token = yield* Effect.result(load(params.token))
							if (
								Result.isSuccess(token) &&
								(token.success._tag === 'Refresh' || token.success._tag === 'UsedRefresh') &&
								token.success.clientId === params.client_id
							) {
								yield* sql`DELETE FROM auth_state WHERE json_extract(payload, '$.family') = ${token.success.family}`
							}
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
							const state = yield* save({_tag: 'Login', ...params, verifier}, 600)
							const authorize = new URL('https://github.com/login/oauth/authorize')
							authorize.search = UrlParams.toString(
								UrlParams.fromInput({
									client_id: provider.clientId,
									code_challenge: yield* hash(verifier),
									code_challenge_method: 'S256',
									redirect_uri: `${url}/auth/github/callback`,
									state
								})
							)
							return HttpServerResponse.setCookieUnsafe(
								HttpServerResponse.redirect(authorize.href),
								LOGIN_COOKIE,
								state,
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
							const flow = yield* sql.withTransaction(
								Effect.gen(function* () {
									const stored = yield* load(params.state)
									if (stored._tag !== 'Login') return yield* AuthError.make({message: 'The sign-in expired'})
									yield* remove(params.state)
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
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubToken))
							)
							const github = yield* pipe(
								HttpClientRequest.get('https://api.github.com/user'),
								HttpClientRequest.bearerToken(token.access_token),
								HttpClientRequest.setHeaders({accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}),
								request => client.execute(request),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser))
							)
							const signedInToken = yield* register(github)
							return HttpServerResponse.setCookieUnsafe(
								HttpServerResponse.expireCookieUnsafe(
									HttpServerResponse.redirect(
										Boolean.match(flow.request === undefined, {
											onFalse: () => `/?request=${flow.request}`,
											onTrue: () => '/'
										})
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
							yield* remove((yield* HttpServerRequest.HttpServerRequest).cookies[SESSION_COOKIE] ?? '')
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
					return SqliteClient.layer({filename: path.join(directory, 'auth.sqlite')})
				})
			)
		)
	)
}
