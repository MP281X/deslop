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
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	Url,
	UrlParams
} from 'effect/http'

import type {PendingAuthorization} from '#schema.ts'
import {
	AuthError,
	AuthorizationRow,
	AuthorizationStatus,
	AuthorizeParams,
	CallbackParams,
	ConsentParams,
	GitHubToken,
	GitHubUser,
	Registration,
	Resource,
	RevokeParams,
	SignInParams,
	Stored,
	StoredRow,
	TokenParams,
	User,
	VerificationParams
} from '#schema.ts'

import {AUTH_URL, CurrentUser, RpcAuth} from '#lib/utils.ts'

const SESSION_COOKIE = '__Secure-session'
const LOGIN_COOKIE = '__Host-login'
const REQUEST_COOKIE = '__Host-request-'
const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

function provide(auth: typeof Auth.Service) {
	return pipe(
		Context.make(Auth, auth),
		Context.add(
			RpcAuth,
			RpcAuth.of((effect, request) =>
				pipe(
					auth.user(request.headers),
					Effect.flatMap(user => Effect.provideService(effect, CurrentUser, user))
				)
			)
		)
	)
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

function allowedRedirect(redirect: string) {
	if (redirect === 'stash://auth/callback' || redirect === 'stash-dev://auth/callback') return true
	return Result.match(Url.fromString(redirect), {
		onFailure: () => false,
		onSuccess: target =>
			target.protocol === 'http:' &&
			(target.hostname === '127.0.0.1' || target.hostname === 'localhost') &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password) &&
			String.isEmpty(target.search) &&
			String.isEmpty(target.hash)
	})
}

export class Authorizations extends Context.Service<
	Authorizations,
	{
		readonly pending: (headers: Headers.Headers) => Stream.Stream<PendingAuthorization[], AuthError>
		readonly wait: (id: string, headers: Headers.Headers) => Stream.Stream<AuthorizationStatus, AuthError>
	}
>()('@deslop/auth/service/Authorizations') {}

export class Auth extends Context.Service<
	Auth,
	{
		readonly user: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		readonly access: (headers: Headers.Headers, resource: string) => Effect.Effect<User, AuthError>
	}
>()('@deslop/auth/service/Auth') {
	static readonly layer = (resource: string) =>
		Layer.effectContext(
			Effect.gen(function* () {
				const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const origins = [new URL(url).origin, ...Array.map(Resource.literals, identifier => new URL(identifier).origin)]
				const access = Effect.fn('Auth.access')(function* (headers: Headers.Headers, audience: string) {
					return yield* pipe(
						client.get(`${url}/auth/verify`, {
							headers: {authorization: headers['authorization'] ?? ''},
							urlParams: {resource: audience}
						}),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
						Effect.timeout('10 seconds')
					)
				}, rejected('Sign in first'))
				return provide(
					Auth.of({
						access,
						user: Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
							if (Option.isSome(Headers.get(headers, 'authorization'))) {
								return yield* access(headers, resource)
							}
							if (Option.exists(Headers.get(headers, 'origin'), origin => !Array.contains(origins, origin))) {
								return yield* AuthError.make({message: 'The request comes from another origin'})
							}
							return yield* pipe(
								client.get(`${url}/auth/session`, {headers: {cookie: headers['cookie'] ?? ''}}),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
								Effect.timeout('10 seconds')
							)
						}, rejected('Sign in first'))
					})
				)
			})
		)

	static readonly layerIssuer = pipe(
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
					clientId: Config.String('GITHUB_CLIENT_ID'),
					secret: Config.Redacted('GITHUB_CLIENT_SECRET'),
					users: Config.Array(Schema.String, 'GITHUB_USERS')
				})
				yield* sql`CREATE TABLE IF NOT EXISTS auth_state (hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)`
				// Pending authorizations from the previous release have no separate public identifier.
				yield* sql`DELETE FROM auth_state WHERE json_extract(payload, '$._tag') = 'Request' AND json_extract(payload, '$.id') IS NULL`
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
				const allowed = Effect.fnUntraced(function* (user: User) {
					if (!Array.contains(provider.users, String.replace('github:', '')(user.id))) {
						return yield* AuthError.make({error: 'access_denied', message: 'This GitHub account is not allowed'})
					}
					return user
				})
				const session = Effect.fnUntraced(function* (headers: Headers.Headers) {
					const stored = yield* load(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE] ?? '')
					if (stored._tag !== 'Session') return yield* AuthError.make({message: 'Sign in first'})
					return yield* allowed(stored.user)
				}, rejected('Sign in first'))
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
				function publicRequest(request: typeof Stored.cases.Request.Type, expiresAt: number) {
					return {
						...pipe(request, Struct.pick(['clientName', 'createdAt', 'id', 'redirectUri', 'resources'])),
						expiresAt
					}
				}
				const pending = Effect.fnUntraced(function* (headers: Headers.Headers) {
					yield* session(headers)
					const rows = yield* pipe(
						sql`SELECT payload, hash, expires_at AS "expiresAt" FROM auth_state WHERE json_extract(payload, '$._tag') = 'Request' AND json_extract(payload, '$.decision._tag') = 'Pending' AND expires_at > ${yield* Clock.currentTimeMillis} ORDER BY json_extract(payload, '$.createdAt') DESC, hash`,
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AuthorizationRow)))
					)
					return yield* Effect.forEach(
						rows,
						Effect.fnUntraced(function* (row) {
							return publicRequest(
								yield* Schema.decodeEffect(Schema.fromJsonString(Stored.cases.Request))(row.payload),
								row.expiresAt
							)
						}),
						{concurrency: 1}
					)
				}, rejected('Cannot read pending authorizations'))
				const respond = Effect.fn('Authorizations.respond')(function* (
					params: ConsentParams,
					headers: Headers.Headers
				) {
					yield* checkOrigin(headers)
					const user = yield* session(headers)
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
				}, rejected('Cannot answer the authorization request'))
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
								return yield* AuthError.make({message: 'Use a Codex, Claude Code or Stash callback'})
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
									const id = Base64Url.encode(yield* random.randomBytes(16))
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
							const user = yield* allowed({id: `github:${github.id}`, name: github.login})
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
								yield* save({_tag: 'Session', user}, 365 * 86400),
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
					provide(
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
							pending: headers =>
								watch(pending(headers), requests =>
									Array.reduce(requests, Infinity, (expiresAt, request) => Number.min(expiresAt, request.expiresAt))
								),
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
					const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth-server')
					yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
					return SqliteClient.layer({filename: path.join(directory, 'auth.sqlite')})
				})
			)
		)
	)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) return HttpServerResponse.text('Sign in first', {status: 401})
				return yield* Effect.provideService(app, CurrentUser, user.success)
			})
	})
)

export function layerMcpAuth(resource: string) {
	return HttpRouter.middleware<{provides: CurrentUser}>()(
		Effect.gen(function* () {
			const auth = yield* Auth
			return app =>
				Effect.gen(function* () {
					const user = yield* Effect.result(auth.access((yield* HttpServerRequest.HttpServerRequest).headers, resource))
					if (Result.isFailure(user)) {
						return HttpServerResponse.text('Authorization required', {
							headers: {
								'www-authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', resource).href}", scope="deslop"`
							},
							status: 401
						})
					}
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
