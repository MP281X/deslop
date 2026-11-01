import {NodeCrypto, NodeHttpClient, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Effect, FileSystem, Layer, PlatformError, Ref, Sink, Stdio, String, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse} from 'effect/http'

import {oauth} from '#cli/oauth.ts'

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NodeHttpClient.layerFetch), {excludeTestServices: true})(
	'CLI OAuth',
	test => {
		test.effect(
			'uses a real loopback callback with state/issuer checks and S256 PKCE without putting tokens on stdout',
			Effect.fnUntraced(function* () {
				const fs = yield* FileSystem.FileSystem
				const home = yield* fs.makeTempDirectoryScoped()
				const network = yield* HttpClient.HttpClient
				const challenge = yield* Ref.make('')
				const verifier = yield* Ref.make('')
				const stdout = yield* Ref.make(0)
				const client = HttpClient.make(request =>
					Effect.gen(function* () {
						if (String.includes('well-known')(request.url)) {
							const origin = new URL(request.url).origin
							return HttpClientResponse.fromWeb(
								request,
								Response.json({
									authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
									issuer: `${origin}/api/auth`,
									registration_endpoint: `${origin}/api/auth/oauth2/register`,
									token_endpoint: `${origin}/api/auth/oauth2/token`
								})
							)
						}
						if (String.endsWith('/register')(request.url)) {
							return HttpClientResponse.fromWeb(request, Response.json({client_id: 'fixture-client'}))
						}
						if (request.body._tag !== 'Uint8Array') return yield* Effect.die('Unexpected OAuth body')
						const params = new URLSearchParams(new TextDecoder().decode(request.body.body))
						assert.strictEqual(params.get('grant_type'), 'authorization_code')
						assert.deepStrictEqual(params.getAll('resource'), [
							'https://scope.example.com',
							'https://scope.example.com/mcp'
						])
						yield* Ref.set(verifier, params.get('code_verifier') ?? '')
						return HttpClientResponse.fromWeb(
							request,
							Response.json({access_token: 'fixture-access', expires_in: 900, refresh_token: 'fixture-refresh'})
						)
					})
				)
				const stdio = Stdio.make({
					args: Effect.succeed([]),
					stderr: () =>
						Sink.forEach(chunk =>
							pipe(
								Effect.gen(function* () {
									if (!String.isString(chunk)) return yield* Effect.die('Expected a text authorization URL')
									const address = yield* pipe(
										Effect.fromOption(
											Array.findFirst(String.split(chunk, '\n'), String.startsWith('https://auth.example.com/'))
										),
										Effect.mapError(cause => PlatformError.badArgument({cause, method: 'authorize', module: 'fixture'}))
									)
									const url = new URL(address)
									yield* Ref.set(challenge, url.searchParams.get('code_challenge') ?? '')
									assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256')
									const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
									redirect.search = new URLSearchParams({
										code: 'fixture-code',
										iss: 'https://evil.example.com',
										state: url.searchParams.get('state') ?? ''
									}).toString()
									assert.strictEqual((yield* network.get(redirect.href)).status, 400)
									redirect.searchParams.set('iss', 'https://auth.example.com/api/auth')
									assert.strictEqual((yield* network.get(redirect.href)).status, 200)
								}),
								Effect.mapError(cause => PlatformError.badArgument({cause, method: 'callback', module: 'fixture'}))
							)
						),
					stdin: (yield* Stdio.Stdio).stdin,
					stdout: () => Sink.forEach(() => Ref.update(stdout, n => n + 1))
				})
				yield* pipe(
					Effect.gen(function* () {
						const session = yield* oauth('scope', 'https://scope.example.com', 'https://auth.example.com')
						yield* session.login
						assert.strictEqual(yield* session.token, 'fixture-access')
						assert.isTrue(
							(yield* Effect.result(
								(yield* oauth('scope', 'https://scope.example.com', 'https://other.example.com')).token
							))._tag === 'Failure'
						)
					}),
					Effect.provideService(HttpClient.HttpClient, client),
					Effect.provideService(Stdio.Stdio, stdio),
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({HOME: home}))
				)
				assert.strictEqual(yield* Ref.get(stdout), 0)
				assert.strictEqual(
					Base64Url.encode(
						yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(yield* Ref.get(verifier)))
					),
					yield* Ref.get(challenge)
				)
				assert.isTrue(
					yield* fs.exists(
						`${home}/.deslop/scope/oauth/${encodeURIComponent('https://auth.example.com')}-${encodeURIComponent('https://scope.example.com')}.json`
					)
				)
			})
		)
	}
)
