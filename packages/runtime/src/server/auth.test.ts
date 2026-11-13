import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Layer,
	Queue,
	Redacted,
	Ref,
	Schema,
	pipe
} from 'effect'

import {Signature} from 'effect/crypto'
import {Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import {Rpc, RpcMessage} from 'effect/rpc'
import {TestClock} from 'effect/testing'

import {Auth, HttpAuth, layerMcpAuth} from './auth.ts'

import {AiGateway, AiUnavailableError} from '#server/ai.ts'
import {Sessions} from '#server/sessions.ts'
import {layerDataStore} from '#server/store.ts'
import {
	AccessClaims,
	AuthError,
	ClientId,
	CurrentUser,
	DEVELOPER,
	RpcAuth,
	SESSION_COOKIE,
	UserId,
	needsSignIn
} from '#shared/auth.ts'

const AUTH = 'https://auth.mp281x.xyz'

type AnyClaims = typeof AnyClaims.Type
const AnyClaims = Schema.toEncoded(Schema.Struct({...AccessClaims.fields, aud: Schema.String}))

type Sign = (claims?: Partial<AnyClaims>) => Effect.Effect<string, Jwt.JwtError>

const issuer = Effect.fnUntraced(function* (token: (form: URLSearchParams, sign: Sign) => Effect.Effect<Response>) {
	const pair = yield* Jwk.generateKeyPair({algorithm: 'EdDSA', kid: 'fixture'})
	const key = yield* Jwk.importPrivate(pair.privateKey, 'EdDSA')
	const signature = yield* Signature.Signature
	const down = yield* Ref.make(false)
	const sign: Sign = Effect.fnUntraced(function* (claims = {}) {
		const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
		const signed = yield* Effect.provideService(
			Jwt.sign(
				AnyClaims,
				{
					aud: 'deslop',
					azp: 'Fixture',
					exp: now + 600,
					iat: now,
					iss: `${AUTH}/api/auth`,
					name: 'octocat',
					sid: 'family',
					sub: UserId.make('github:42'),
					...claims
				},
				key,
				{kid: 'fixture', typ: 'at+jwt'}
			),
			Signature.Signature,
			signature
		)
		return Redacted.value(signed)
	})
	const client = HttpClient.make(request =>
		Effect.gen(function* () {
			if (request.url === `${AUTH}/.well-known/jwks.json`) {
				if (yield* Ref.get(down)) return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 503}))
				return HttpClientResponse.fromWeb(request, Response.json({keys: [pair.publicKey]}))
			}
			if (request.url === `${AUTH}/api/auth/oauth2/token` && request.body._tag === 'Uint8Array') {
				return HttpClientResponse.fromWeb(
					request,
					yield* token(new URLSearchParams(new TextDecoder().decode(request.body.body)), sign)
				)
			}
			return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
		})
	)
	return {client, down, sign}
})

function layerAuth(client: HttpClient.HttpClient, settings: Record<string, string>) {
	return pipe(
		Auth.layer,
		Layer.provideMerge(AiGateway.layer),
		Layer.provideMerge(Sessions.layer),
		Layer.provide(
			Layer.mergeAll(
				Layer.provide(
					Layer.unwrap(
						pipe(
							FileSystem.FileSystem,
							Effect.flatMap(fs => fs.makeTempDirectoryScoped()),
							Effect.map(layerDataStore)
						)
					),
					NodeServices.layer
				),
				NodeCrypto.layer,
				Layer.succeed(HttpClient.HttpClient, client)
			)
		),
		Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown(settings)))
	)
}

it.effect('ends a running RPC once its credentials are rejected, not while the issuer is down', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const verdict = yield* Ref.make<NonNullable<AuthError['error']> | 'valid'>('valid')
			const user = Effect.flatMap(Ref.get(verdict), current => {
				if (current === 'valid') return Effect.succeed({id: UserId.make('github:42'), name: 'octocat'})
				return Effect.fail(AuthError.make({error: current, message: 'rejected'}))
			})
			const watch = yield* Effect.forkScoped(
				Context.get(Auth.makeContext(Auth.of({token: () => Effect.succeed('token'), user: () => user})), RpcAuth)(
					Effect.never,
					{
						client: new Rpc.ServerClient(0),
						headers: Headers.empty,
						payload: undefined,
						requestId: RpcMessage.RequestId(0),
						rpc: Rpc.make('session.watch')
					}
				)
			)
			yield* TestClock.adjust('5 minutes')
			yield* Ref.set(verdict, 'temporarily_unavailable')
			yield* TestClock.adjust('5 minutes')
			assert.isUndefined(watch.pollUnsafe())
			yield* Ref.set(verdict, 'invalid_grant')
			yield* TestClock.adjust('5 minutes')
			assert.isTrue(Exit.hasFails(yield* Fiber.await(watch)))
		})
	)
)

const serve = Effect.fnUntraced(function* (client: HttpClient.HttpClient) {
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.provide(HttpRouter.add('POST', '/ingest', HttpServerResponse.empty({status: 200})), HttpAuth.layer),
					Layer.merge(
						Layer.provide(
							HttpRouter.add('GET', '/mcp', HttpServerResponse.empty({status: 200})),
							layerMcpAuth('https://scope.mp281x.xyz/mcp')
						)
					),
					Layer.provide(layerAuth(client, {APP_URL: 'https://scope.mp281x.xyz', AUTH_URL: AUTH}))
				),
				{disableLogger: true}
			)
		),
		value => Effect.promise(() => value.dispose())
	)
	return (path: string, headers: Record<string, string>) =>
		Effect.promise(() =>
			web.handler(
				new Request(`https://scope.mp281x.xyz${path}`, {
					headers,
					method: Boolean.match(path === '/mcp', {onFalse: () => 'POST', onTrue: () => 'GET'})
				})
			)
		)
})

it.layer(NodeCrypto.layer, {excludeTestServices: true})(test => {
	test.effect(
		"accepts Auth's signed access token and refuses an expired or foreign one",
		Effect.fnUntraced(function* () {
			const auth = yield* issuer(() => Effect.succeed(new Response(undefined, {status: 400})))
			const request = yield* serve(auth.client)
			const discovery = yield* request('/mcp', {})
			assert.strictEqual(discovery.status, 401)
			assert.include(discovery.headers.get('www-authenticate') ?? '', 'resource_metadata=')
			assert.notInclude(discovery.headers.get('www-authenticate') ?? '', 'invalid_token')

			const signed = {authorization: `Bearer ${yield* auth.sign()}`}
			assert.strictEqual((yield* request('/mcp', signed)).status, 200)
			assert.strictEqual((yield* request('/ingest', signed)).status, 200)

			for (const claims of [{exp: 1}, {aud: 'elsewhere'}]) {
				const refused = {authorization: `Bearer ${yield* auth.sign(claims)}`}
				const rejected = yield* request('/mcp', refused)
				assert.strictEqual(rejected.status, 401)
				assert.include(rejected.headers.get('www-authenticate') ?? '', 'error="invalid_token"')
				assert.strictEqual((yield* request('/ingest', refused)).status, 401)
			}
			// A session id is this app's own sign-in, never an MCP client's.
			assert.strictEqual((yield* request('/mcp', {authorization: 'Bearer some-session'})).status, 401)
		})
	)

	test.effect(
		'answers 503 while Auth cannot serve its key set, not a refusal',
		Effect.fnUntraced(function* () {
			const auth = yield* issuer(() => Effect.succeed(new Response(undefined, {status: 400})))
			yield* Ref.set(auth.down, true)
			const request = yield* serve(auth.client)
			const signed = {authorization: `Bearer ${yield* auth.sign()}`}
			const unavailable = yield* request('/mcp', signed)
			assert.strictEqual(unavailable.status, 503)
			assert.strictEqual(unavailable.headers.get('retry-after'), '5')
			assert.isFalse(unavailable.headers.has('www-authenticate'))
			assert.strictEqual((yield* request('/ingest', signed)).status, 503)
		})
	)
})

it.layer(NodeCrypto.layer)(test => {
	test.effect(
		'uses the freshest session for AI, then a recent verified bearer, and asks to open the app otherwise',
		Effect.fnUntraced(function* () {
			const refreshes = yield* Ref.make(0)
			const issuerService = yield* issuer((form, sign) =>
				Effect.orDie(
					Effect.gen(function* () {
						if (form.get('grant_type') === 'refresh_token') yield* Ref.update(refreshes, count => count + 1)
						return Response.json({
							access_token: yield* sign({azp: 'Stash', sid: form.get('code') ?? 'renewed'}),
							expires_in: 600,
							refresh_token: 'refresh'
						})
					})
				)
			)
			const context = yield* Layer.build(
				layerAuth(issuerService.client, {
					APP_URL: 'https://stash.mp281x.xyz',
					AUTH_URL: AUTH,
					GATEWAY_URL: 'https://gateway.mp281x.xyz'
				})
			)
			const auth = Context.get(context, Auth)
			const sessions = Context.get(context, Sessions)
			const gateway = Context.get(context, AiGateway)
			const missing = yield* Effect.flip(gateway.authorize(UserId.make('github:42')))
			assert.instanceOf(missing, AiUnavailableError)
			// oxlint-disable-next-line @deslop/coding-standards/no-error-message-assertion -- The instruction is the public recovery contract.
			assert.equal(missing.message, 'Open Stash once so it can use AI for you')
			const bearer = yield* issuerService.sign({azp: 'Claude Code', sid: 'bearer'})
			assert.equal((yield* auth.user(Headers.fromInput({authorization: `Bearer ${bearer}`}))).client, 'Claude Code')
			const echo = HttpClient.make(request =>
				Effect.succeed(
					HttpClientResponse.fromWeb(request, Response.json({authorization: request.headers['authorization']}))
				)
			)
			const authorization = Effect.fnUntraced(function* () {
				return yield* (yield* (yield* gateway.authorize(UserId.make('github:42')))(echo).get(
					'https://gateway.mp281x.xyz/ai/connection/v1/messages'
				)).json
			})
			assert.deepEqual(yield* authorization(), {authorization: `Bearer ${bearer}`})
			assert.instanceOf(yield* Effect.flip(gateway.authorize(UserId.make('github:43'))), AiUnavailableError)
			const first = yield* sessions.start({
				client_id: ClientId.make('stash'),
				code: 'first',
				code_verifier: 'verifier',
				redirect_uri: 'https://stash.mp281x.xyz/auth/callback'
			})
			yield* TestClock.adjust('1 second')
			const second = yield* sessions.start({
				client_id: ClientId.make('stash'),
				code: 'second',
				code_verifier: 'verifier',
				redirect_uri: 'https://stash.mp281x.xyz/auth/callback'
			})
			const current = yield* sessions.current(second)
			assert.deepEqual(yield* authorization(), {authorization: `Bearer ${current.token}`})
			yield* TestClock.adjust('541 seconds')
			assert.notDeepEqual(yield* authorization(), {authorization: `Bearer ${current.token}`})
			assert.equal(yield* Ref.get(refreshes), 1)
			yield* sessions.end(first)
			yield* sessions.end(second)
			assert.instanceOf(yield* Effect.flip(gateway.authorize(UserId.make('github:42'))), AiUnavailableError)
			yield* auth.user(
				Headers.fromInput({
					authorization: `Bearer ${yield* issuerService.sign({exp: Math.floor((yield* Clock.currentTimeMillis) / 1000) + 59})}`
				})
			)
			assert.instanceOf(yield* Effect.flip(gateway.authorize(UserId.make('github:42'))), AiUnavailableError)
		})
	)

	test.effect(
		"refreshes a session's access token once for concurrent requests and forgets the session Auth refuses",
		Effect.fnUntraced(function* () {
			const refreshes = yield* Queue.unbounded<string>()
			const release = yield* Deferred.make<void>()
			const refused = yield* Ref.make(false)
			const auth = yield* issuer((form, sign) =>
				Effect.orDie(
					Effect.gen(function* () {
						if (form.get('grant_type') === 'authorization_code') {
							return Response.json({access_token: yield* sign(), expires_in: 600, refresh_token: 'refresh-1'})
						}
						yield* Queue.offer(refreshes, form.get('refresh_token') ?? '')
						if (yield* Ref.get(refused)) return Response.json({error: 'invalid_grant'}, {status: 400})
						yield* Deferred.await(release)
						return Response.json({
							access_token: yield* sign({name: 'renamed'}),
							expires_in: 600,
							refresh_token: 'refresh-2'
						})
					})
				)
			)
			const context = yield* Layer.build(layerAuth(auth.client, {APP_URL: 'https://scope.mp281x.xyz', AUTH_URL: AUTH}))
			const service = Context.get(context, Auth)
			const id = yield* Context.get(context, Sessions).start({
				client_id: ClientId.make('scope'),
				code: 'approved',
				code_verifier: 'verifier',
				redirect_uri: 'https://scope.mp281x.xyz/auth/callback'
			})
			const headers = Headers.fromInput({cookie: `${SESSION_COOKIE}=${id}`})
			assert.strictEqual((yield* service.user(headers)).name, 'octocat')

			yield* TestClock.adjust('541 seconds')
			const first = yield* Effect.forkChild(service.token(headers))
			assert.strictEqual(yield* Queue.take(refreshes), 'refresh-1')
			const second = yield* Effect.forkChild(service.user(headers))
			yield* TestClock.adjust(0)
			yield* Deferred.succeed(release, undefined)
			const renewed = yield* Fiber.join(first)
			assert.strictEqual((yield* Fiber.join(second)).name, 'renamed')
			assert.strictEqual(yield* service.token(headers), renewed)
			assert.strictEqual(yield* Queue.size(refreshes), 0)

			yield* Ref.set(refused, true)
			yield* TestClock.adjust('541 seconds')
			assert.isTrue(needsSignIn(yield* Effect.flip(service.user(headers))))
			assert.strictEqual(yield* Queue.take(refreshes), 'refresh-2')
			assert.isTrue(needsSignIn(yield* Effect.flip(service.token(headers))))
			assert.strictEqual(yield* Queue.size(refreshes), 0)
		}, Effect.scoped)
	)

	test.effect(
		'signs every request in as the developer without an issuer, never reaching one',
		Effect.fnUntraced(function* () {
			const calls = yield* Ref.make(0)
			const client = HttpClient.make(request =>
				pipe(
					calls,
					Ref.update(count => count + 1),
					Effect.as(HttpClientResponse.fromWeb(request, new Response(undefined, {status: 401})))
				)
			)
			const web = yield* Effect.acquireRelease(
				Effect.sync(() =>
					HttpRouter.toWebHandler(
						pipe(
							Layer.provide(
								HttpRouter.add(
									'GET',
									'/me',
									Effect.map(CurrentUser, user => HttpServerResponse.text(user.name))
								),
								HttpAuth.layer
							),
							Layer.merge(
								Layer.provide(
									HttpRouter.add(
										'GET',
										'/mcp',
										Effect.map(CurrentUser, user => HttpServerResponse.text(user.name))
									),
									layerMcpAuth('https://scope.mp281x.xyz/mcp')
								)
							),
							Layer.provide(layerAuth(client, {APP_URL: 'https://scope.mp281x.xyz'}))
						),
						{disableLogger: true}
					)
				),
				value => Effect.promise(() => value.dispose())
			)
			for (const path of ['/me', '/mcp']) {
				const response = yield* Effect.promise(() =>
					web.handler(new Request(`https://desktop.tailnet-8c4c.ts.net:23475${path}`))
				)
				assert.strictEqual(response.status, 200)
				assert.strictEqual(yield* Effect.promise(() => response.text()), DEVELOPER.name)
			}
			assert.strictEqual(yield* Ref.get(calls), 0)
		})
	)
})
