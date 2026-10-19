// @effect-diagnostics-next-line nodeBuiltinImport:off -- Better Auth's database adapter accepts Node's native SQLite handle.
import {DatabaseSync} from 'node:sqlite'

import {
	Array,
	Boolean,
	Config,
	Context,
	Crypto,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Redacted,
	Result,
	Schema,
	String,
	pipe
} from 'effect'

import {cimd} from '@better-auth/cimd'
import {fetchClientMetadataResource} from '@better-auth/cimd/node'
import {mcp} from '@better-auth/mcp'
import {createResourceServerChallenge} from '@better-auth/oauth-provider'
import {betterAuth, type BetterAuthOptions} from 'better-auth'
import {APIError} from 'better-auth/api'
import {getMigrations} from 'better-auth/db/migration'
import {requestToResourceInput, verifyAccessTokenRequest} from 'better-auth/oauth2'
import {jwt} from 'better-auth/plugins'
import {Base64Url} from 'effect/encoding'
import {Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {AccessClaims, Account, AuthError, BrowserSession, GitHubIdentity, User, Verification} from '#schema.ts'

import {AUTH_URL, CurrentUser, RpcAuth, development} from '#lib/utils.ts'

const RESOURCES = [
	'https://stash.mp281x.xyz',
	'https://stash.mp281x.xyz/mcp',
	'https://scope.mp281x.xyz',
	'https://scope.mp281x.xyz/mcp',
	'https://portfolio.mp281x.xyz/mcp',
	'https://otel.mp281x.xyz'
]
const DEVELOPER = User.make({id: 'development', name: 'Developer'})

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

function issuerOptions(options: {
	database: DatabaseSync
	clientId: string
	clientSecret: string
	secret: string
	users: string[]
	url: string
}) {
	return {
		account: {accountLinking: {enabled: false}, encryptOAuthTokens: true},
		advanced: {
			crossSubDomainCookies: {
				domain: pipe(new URL(options.url).hostname, String.split('.'), Array.drop(1), Array.join('.')),
				enabled: true
			}
		},
		appName: 'Deslop',
		baseURL: options.url,
		database: options.database,
		disabledPaths: ['/token'],
		plugins: [
			jwt(),
			mcp({
				accessTokenExpiresIn: 90_000,
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
				clientRegistrationDefaultApplicationType: 'infer',
				clientRegistrationDefaultResources: RESOURCES,
				consentPage: '/',
				customAccessTokenClaims: info => {
					if (!Schema.is(Account)(info.user) || !Array.contains(options.users, info.user.githubId)) {
						throw new APIError('FORBIDDEN', {message: 'This GitHub account is not allowed'})
					}
					return {user: {id: `github:${info.user.githubId}`, name: info.user.name}}
				},
				grantTypes: ['authorization_code', 'refresh_token'],
				loginPage: '/',
				// The app and share extension can refresh the same shared Keychain credential concurrently.
				refreshTokenReuseInterval: 60,
				resource: 'https://scope.mp281x.xyz/mcp',
				resourceSeedMode: 'overwrite',
				// iOS queues share-sheet uploads for a day; their bearer must outlive that queue and upload window.
				resources: Array.map(RESOURCES, identifier => ({
					accessTokenTtl: Boolean.match(
						identifier === 'https://stash.mp281x.xyz' || identifier === 'https://otel.mp281x.xyz',
						{onFalse: () => 900, onTrue: () => 90_000}
					),
					identifier
				})),
				scopes: ['deslop', 'offline_access']
			}),
			cimd({fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28'})
		],
		secret: options.secret,
		socialProviders: {
			github: {
				clientId: options.clientId,
				clientSecret: options.clientSecret,
				mapProfileToUser: profile => ({
					githubId: `${Schema.decodeSync(GitHubIdentity)(profile).id}`,
					name: profile.login
				}),
				redirectURI: `${options.url}/auth/github/callback`
			}
		},
		trustedOrigins: [
			'https://auth.mp281x.xyz',
			'https://stash.mp281x.xyz',
			'https://scope.mp281x.xyz',
			'https://portfolio.mp281x.xyz',
			'https://otel.mp281x.xyz'
		],
		user: {
			additionalFields: {githubId: {input: false, required: true, type: 'string'}},
			validateUserInfo: info => {
				if (
					info.source.oauth?.providerId !== 'github' ||
					!Schema.is(GitHubIdentity)(info.source.oauth.profile) ||
					!Array.contains(options.users, `${info.source.oauth.profile.id}`)
				) {
					return {error: 'github_not_allowed', errorDescription: 'This GitHub account is not allowed'}
				}
				return undefined
			}
		}
	} satisfies BetterAuthOptions
}

export class Issuer extends Context.Service<Issuer, ReturnType<typeof betterAuth<ReturnType<typeof issuerOptions>>>>()(
	'@deslop/auth/service/Issuer'
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth-server')
			yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
			const database = yield* Effect.acquireRelease(
				Effect.sync(() => new DatabaseSync(path.join(directory, 'auth.sqlite'))),
				db => Effect.sync(() => db.close())
			)
			const provider = yield* Config.option(
				Config.all({
					clientId: Config.String('GITHUB_CLIENT_ID'),
					secret: Config.Redacted('GITHUB_CLIENT_SECRET'),
					users: Config.Array(Schema.String, 'GITHUB_USERS')
				})
			)
			const config = Option.getOrElse(provider, () => ({
				clientId: 'unconfigured',
				secret: Redacted.make('unconfigured-github-sign-in-disabled'),
				users: []
			}))
			const secret = Base64Url.encode(
				yield* (yield* Crypto.Crypto).digest(
					'SHA-256',
					new TextEncoder().encode(`@deslop/auth ${Redacted.value(config.secret)}`)
				)
			)
			const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
			const options = issuerOptions({
				clientId: config.clientId,
				clientSecret: Redacted.value(config.secret),
				database,
				secret,
				url,
				users: Array.fromIterable(config.users)
			})
			yield* Effect.tryPromise(() => getMigrations(options).then(plan => plan.runMigrations()))
			const issuer = betterAuth(options)
			const router = yield* HttpRouter.HttpRouter
			const handler = Effect.gen(function* () {
				const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest)
				return HttpServerResponse.fromWeb(yield* Effect.tryPromise(() => issuer.handler(request)))
			})
			yield* router.add('*', '/api/auth/*', handler)
			yield* router.add('GET', '/.well-known/*', handler)
			yield* router.add('GET', '/auth/users', HttpServerResponse.schemaJson(Verification)({users: config.users}))
			// GitHub's registered callback remains unchanged while Better Auth owns the code exchange.
			yield* router.add(
				'GET',
				'/auth/github/callback',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest)
					const target = new URL(request.url)
					target.pathname = '/api/auth/callback/github'
					return HttpServerResponse.fromWeb(
						yield* Effect.tryPromise(() => issuer.handler(new Request(target, request)))
					)
				})
			)
			return issuer
		})
	)
}

export class Auth extends Context.Service<
	Auth,
	{
		readonly user: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		readonly access: (request: Request, resource: string) => Effect.Effect<User, AuthError>
	}
>()('@deslop/auth/service/Auth') {
	static readonly layer = (resource: string) =>
		Layer.effectContext(
			Effect.gen(function* () {
				const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const dev = yield* development
				const policy = yield* pipe(
					client.get(`${url}/auth/users`),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Verification)),
					Effect.cachedWithTTL('1 minute')
				)
				const allowed = Effect.fnUntraced(function* (user: User) {
					if (!Array.contains((yield* policy).users, String.replace('github:', '')(user.id))) {
						return yield* AuthError.make({message: 'This GitHub account is not allowed'})
					}
					return user
				})
				const access = Effect.fn('Auth.access')(function* (request: Request, audience: string) {
					const claims = yield* Effect.tryPromise({
						catch: cause => AuthError.make({cause, message: 'Sign in first'}),
						try: () =>
							verifyAccessTokenRequest(requestToResourceInput(request), {
								jwksUrl: `${url}/api/auth/jwks`,
								requiredScopes: ['deslop'],
								verifyOptions: {audience, issuer: `${url}/api/auth`}
							})
					})
					return yield* allowed((yield* Schema.decodeUnknownEffect(AccessClaims)(claims)).user)
				}, rejected('Sign in first'))
				const user = Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
					if (dev) return DEVELOPER
					if (Option.isSome(Headers.get(headers, 'authorization'))) {
						return yield* access(new Request(resource, {headers}), resource)
					}
					const session = yield* pipe(
						client.get(`${url}/api/auth/get-session`, {headers: {cookie: headers['cookie'] ?? ''}}),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(BrowserSession)),
						Effect.flatMap(value => Effect.fromOption(Option.fromNullishOr(value)))
					)
					return yield* allowed({id: `github:${session.user.githubId}`, name: session.user.name})
				}, rejected('Sign in first'))
				return pipe(
					Context.make(Auth, Auth.of({access, user})),
					Context.add(
						RpcAuth,
						RpcAuth.of((effect, request) =>
							pipe(
								user(request.headers),
								Effect.flatMap(account => Effect.provideService(effect, CurrentUser, account))
							)
						)
					)
				)
			})
		)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return httpEffect =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) return HttpServerResponse.text('Sign in first', {status: 401})
				return yield* Effect.provideService(httpEffect, CurrentUser, user.success)
			})
	})
)

export function layerMcpAuth(resource: string) {
	return HttpRouter.middleware<{provides: CurrentUser}>()(
		Effect.gen(function* () {
			const auth = yield* Auth
			return app =>
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const user = yield* Effect.result(
						auth.access(new Request(resource, {headers: request.headers, method: request.method}), resource)
					)
					if (Result.isFailure(user)) {
						const challenge = createResourceServerChallenge(user.failure.cause, resource, {challengeScopes: ['deslop']})
						return HttpServerResponse.text('Authorization required', {
							headers: challenge?.headers,
							status: challenge?.statusCode ?? 403
						})
					}
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
