import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import type {Path} from 'effect'
import {
	Array,
	Boolean,
	ConfigProvider,
	Context,
	Effect,
	FileSystem,
	Layer,
	Queue,
	Record,
	Redacted,
	Ref,
	String,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import {TestClock} from 'effect/testing'

import {Auth} from '#server/auth.ts'
import {crossSiteGuard, layerAnnounce, layerRoutes} from '#server/http.ts'
import {Sessions} from '#server/sessions.ts'
import {layerSessionRoutes} from '#server/sign-in.ts'
import {layerDataStore} from '#server/store.ts'
import {AccessClaims, AuthError, SESSION_COOKIE, clientIdOf} from '#shared/auth.ts'

const handler = Effect.fnUntraced(function* (
	settings: Record<string, string>,
	options: {auth?: typeof Auth.layer; client?: HttpClient.HttpClient} = {}
) {
	const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
	return yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						HttpRouter.add('POST', '/write', HttpServerResponse.empty()),
						HttpRouter.add('POST', '/v1/traces', HttpServerResponse.empty()),
						layerRoutes,
						layerSessionRoutes
					),
					Layer.provide(options.auth ?? Auth.layer),
					Layer.provide(Sessions.layer),
					Layer.provide(
						Layer.mergeAll(
							Layer.provide(layerDataStore(directory), NodeServices.layer),
							NodeCrypto.layer,
							Layer.succeed(
								HttpClient.HttpClient,
								options.client ??
									HttpClient.make(request =>
										Effect.succeed(HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404})))
									)
							)
						)
					),
					Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown(settings)))
				),
				{disableLogger: true, middleware: crossSiteGuard}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
})

function cookiePairs(response: Response) {
	return Array.map(response.headers.getSetCookie(), header => Array.headNonEmpty(String.split(header, ';')))
}

const send = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof handler>>,
	method: 'GET' | 'POST',
	url: string,
	headers: Record<string, string>
) {
	const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
	return yield* Effect.promise(() => web.handler(new Request(url, {headers, method}), context))
})

it.effect('does not keep announcing an app Auth permanently rejects', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0)
			const requests = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(attempts, count => count + 1)
					yield* Queue.offer(requests, undefined)
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 403}))
				})
			)
			yield* Layer.build(
				pipe(
					layerAnnounce,
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								APP_URL: 'https://desktop.example.ts.net:5102',
								AUTH_URL: 'https://auth.example.com'
							})
						)
					)
				)
			)
			yield* TestClock.adjust('2 seconds')
			yield* Queue.take(requests)
			yield* TestClock.adjust('5 minutes')
			assert.strictEqual(yield* Ref.get(attempts), 1)
		})
	)
)

it.effect('bounds a stalled announcement and respects Auth retry-after before recovering', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0)
			const interrupted = yield* Ref.make(false)
			const requests = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					const attempt = yield* Ref.getAndUpdate(attempts, count => count + 1)
					yield* Queue.offer(requests, undefined)
					if (attempt === 0) return yield* Effect.ensuring(Effect.never, Ref.set(interrupted, true))
					return HttpClientResponse.fromWeb(
						request,
						new Response(undefined, {
							headers: {'retry-after': '120'},
							status: Boolean.match(attempt === 1, {onFalse: () => 200, onTrue: () => 503})
						})
					)
				})
			)
			yield* Layer.build(
				pipe(
					layerAnnounce,
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({APP_URL: 'https://scope.example.com', AUTH_URL: 'https://auth.example.com'})
						)
					)
				)
			)
			yield* TestClock.adjust('2 seconds')
			yield* Queue.take(requests)
			yield* TestClock.adjust('10 seconds')
			assert.isTrue(yield* Ref.get(interrupted))
			yield* TestClock.adjust('1 minute')
			yield* Queue.take(requests)
			yield* TestClock.adjust('119 seconds')
			assert.strictEqual(yield* Ref.get(attempts), 2)
			yield* TestClock.adjust('1 second')
			yield* Queue.take(requests)
			yield* TestClock.adjust('5 minutes')
			assert.strictEqual(yield* Ref.get(attempts), 3)
		})
	)
)

it.layer(Layer.merge(NodeServices.layer, NodeCrypto.layer))('Server guard', test => {
	test.effect('keeps an authorization outage distinct from signing out', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const outage = Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
				const web = yield* handler(
					{APP_URL: 'http://localhost:5000'},
					{auth: Layer.succeedContext(Auth.makeContext(Auth.of({token: () => outage, user: () => outage})))}
				)
				const response = yield* send(web, 'GET', 'http://localhost:5000/api/account', {host: 'localhost:5000'})
				assert.strictEqual(response.status, 503)
				assert.strictEqual(response.headers.get('retry-after'), '5')
			})
		)
	)

	test.effect('reads immutable release metadata once for runtime discovery requests', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const reads = yield* Ref.make(0)
				const context = Context.add(yield* Effect.context<FileSystem.FileSystem | Path.Path>(), FileSystem.FileSystem, {
					...fs,
					readFileString: () =>
						pipe(
							reads,
							Ref.update(count => count + 1),
							pipelineSubject6381 =>
								Effect.andThen(
									pipelineSubject6381,
									Effect.succeed('{"config":{"port":5000},"name":"@deslop/fixture","version":"0.1.12"}')
								)
						)
				})
				const web = yield* handler({APP_URL: 'http://localhost:5000'})
				for (const path of ['/api/runtime', '/api/runtime']) {
					const response = yield* Effect.promise(() =>
						web.handler(new Request(`http://localhost:5000${path}`, {headers: {host: 'localhost:5000'}}), context)
					)
					assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
						name: 'fixture',
						traces: '',
						version: '0.1.12'
					})
				}
				assert.strictEqual(yield* Ref.get(reads), 1)
			})
		)
	)

	test.effect('without an issuer, serves only loopback, IP and canonical hosts, and never redirects to sign-in', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const web = yield* handler({APP_URL: 'https://dev.example.ts.net:25270'})
				for (const host of [
					'localhost:5000',
					'127.0.0.1:5000',
					'[::1]:5000',
					'100.68.201.107',
					'dev.example.ts.net:25270'
				]) {
					assert.strictEqual((yield* send(web, 'POST', `http://${host}/write`, {host})).status, 204, host)
				}
				assert.strictEqual(
					(yield* send(web, 'POST', 'http://rebound.example.com/write', {host: 'rebound.example.com'})).status,
					403
				)
				const signIn = yield* send(web, 'GET', 'https://dev.example.ts.net:25270/auth/sign-in', {
					host: 'dev.example.ts.net:25270'
				})
				assert.isNull(signIn.headers.get('location'))
			})
		)
	)

	test.effect('with an issuer, serves any host but only its own origin, and returns from Auth to this app only', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const web = yield* handler({APP_URL: 'https://scope.example.com', AUTH_URL: 'https://auth.example.com'})
				const host = 'scope.example.com'
				assert.strictEqual(
					(yield* send(web, 'POST', 'https://other.example.ts.net/write', {host: 'other.example.ts.net'})).status,
					204
				)
				assert.strictEqual(
					(yield* send(web, 'POST', `https://${host}/write`, {host, origin: `https://${host}`})).status,
					204
				)
				assert.strictEqual(
					(yield* send(web, 'POST', `https://${host}/write`, {host, origin: 'https://evil.example.com'})).status,
					403
				)
				assert.strictEqual(
					(yield* send(web, 'POST', `https://${host}/write`, {
						host,
						origin: 'https://evil.example.com',
						'sec-fetch-site': 'same-origin'
					})).status,
					204
				)
				assert.strictEqual(
					(yield* send(web, 'POST', `https://${host}/v1/traces`, {host, origin: 'https://evil.example.com'})).status,
					204
				)
				for (const path of ['/auth/sign-in', '/auth/sign-out']) {
					assert.strictEqual(
						(yield* send(web, 'GET', `https://${host}${path}?next=https%3A%2F%2Fevil.example.com`, {host})).status,
						400
					)
				}
			})
		)
	)

	test.effect('signs in through Auth into a session on this server, and signing out revokes it at Auth', () =>
		pipe(
			Effect.gen(function* () {
				const access = Redacted.value(
					yield* Jwt.sign(
						AccessClaims,
						{
							aud: 'deslop',
							azp: 'Fixture',
							exp: 4_000_000_000,
							iat: 0,
							iss: 'https://auth.example.com/api/auth',
							name: 'octocat',
							sid: 'family',
							sub: 'github:42'
						},
						yield* Jwk.importPrivate((yield* Jwk.generateKeyPair({algorithm: 'EdDSA'})).privateKey, 'EdDSA')
					)
				)
				const calls = yield* Queue.unbounded<URLSearchParams>()
				const client = HttpClient.make(request =>
					Effect.gen(function* () {
						if (request.body._tag !== 'Uint8Array') return yield* Effect.die('Auth takes forms')
						yield* Queue.offer(calls, new URLSearchParams(new TextDecoder().decode(request.body.body)))
						if (String.endsWith('/oauth2/token')(request.url)) {
							return HttpClientResponse.fromWeb(
								request,
								Response.json({access_token: access, expires_in: 600, refresh_token: 'refresh-1'})
							)
						}
						return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 200}))
					})
				)
				const web = yield* handler(
					{APP_URL: 'https://scope.example.com', AUTH_URL: 'https://auth.example.com'},
					{client}
				)
				const host = 'scope.example.com'
				const next = 'https://scope.example.com/detail'

				const started = yield* send(web, 'GET', `https://${host}/auth/sign-in?${new URLSearchParams({next})}`, {host})
				const authorize = new URL(started.headers.get('location') ?? '')
				assert.strictEqual(
					`${authorize.origin}${authorize.pathname}`,
					'https://auth.example.com/api/auth/oauth2/authorize'
				)
				const callback = 'https://scope.example.com/auth/callback'
				assert.deepStrictEqual(
					Record.fromEntries(
						Array.filter([...authorize.searchParams], entry => !Array.contains(['code_challenge', 'state'], entry[0]))
					),
					{
						client_id: clientIdOf({name: 'Fixture', redirects: [callback]}),
						code_challenge_method: 'S256',
						redirect_uri: callback,
						response_type: 'code',
						scope: 'deslop offline_access'
					}
				)
				const signIn = Array.join(cookiePairs(started), '; ')
				const state = authorize.searchParams.get('state') ?? ''

				const forged = yield* send(
					web,
					'GET',
					`https://${host}/auth/callback?${new URLSearchParams({code: 'approved', iss: 'https://auth.example.com/api/auth', state: 'forged'})}`,
					{cookie: signIn, host}
				)
				assert.strictEqual(forged.headers.get('location'), next)
				assert.isFalse(Array.some(cookiePairs(forged), cookie => String.startsWith(`${SESSION_COOKIE}=`)(cookie)))

				const finished = yield* send(
					web,
					'GET',
					`https://${host}/auth/callback?${new URLSearchParams({code: 'approved', iss: 'https://auth.example.com/api/auth', state})}`,
					{cookie: signIn, host}
				)
				assert.strictEqual(finished.headers.get('location'), next)
				const exchange = yield* Queue.take(calls)
				assert.strictEqual(exchange.get('code'), 'approved')
				assert.strictEqual(exchange.get('redirect_uri'), callback)
				// The verifier Auth receives is the one the challenge it saw was made from.
				assert.strictEqual(
					Base64Url.encode(
						yield* (yield* Digest.Digest).digest(
							Digest.sha256,
							new TextEncoder().encode(exchange.get('code_verifier') ?? '')
						)
					),
					authorize.searchParams.get('code_challenge')
				)
				const session = pipe(
					cookiePairs(finished),
					Array.filter(cookie => String.startsWith(`${SESSION_COOKIE}=`)(cookie)),
					Array.join('; ')
				)
				assert.isTrue(String.isNonEmpty(session))

				const user = yield* send(web, 'GET', `https://${host}/api/account`, {cookie: session, host})
				assert.strictEqual(user.status, 200)
				assert.include(yield* Effect.promise(() => user.json()), {id: 'github:42', name: 'octocat'})

				const ended = yield* send(web, 'GET', `https://${host}/auth/sign-out?${new URLSearchParams({next})}`, {
					cookie: session,
					host
				})
				assert.strictEqual(
					ended.headers.get('location'),
					`https://auth.example.com/?${new URLSearchParams({next, 'sign-out': ''})}`
				)
				const revoked = yield* Queue.take(calls)
				assert.strictEqual(revoked.get('token'), 'refresh-1')
				assert.strictEqual(revoked.get('client_id'), exchange.get('client_id'))
				assert.strictEqual(
					(yield* send(web, 'GET', `https://${host}/api/account`, {cookie: session, host})).status,
					401
				)
			}),
			// The app's name, which its client id carries, comes from its package.
			Effect.provideServiceEffect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, fs => ({
					...fs,
					readFileString: () => Effect.succeed('{"config":{"port":5000},"name":"@deslop/fixture","version":"0.1.12"}')
				}))
			),
			Effect.scoped
		)
	)
})
