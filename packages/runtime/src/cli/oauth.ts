// @effect-diagnostics-next-line nodeBuiltinImport:off -- The native OAuth callback listener is a CLI boundary, scoped to one sign-in.
import {createServer} from 'node:http'

import {NodeHttpServer} from '@effect/platform-node'

import {Array, Clock, Deferred, Effect, FileSystem, Option, Path, Schedule, Schema, Stdio, Stream, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'

import {ClientRegistration, Credentials, TokenResponse} from '#auth/schema.ts'
import {configDirectory} from '#cli/config.ts'
import {AppError, OAuthDiscovery} from '#cli/schema.ts'

export const oauth = Effect.fnUntraced(function* (name: string, resource: string, issuer: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = path.join(yield* configDirectory(name), 'oauth')
	yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
	const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
	const origin = yield* Effect.try({
		catch: cause => AppError.make({cause, message: 'Invalid OAuth issuer URL'}),
		try: () => new URL(issuer)
	})
	if (origin.protocol !== 'https:' && !Array.contains(['127.0.0.1', 'localhost', '[::1]'], origin.hostname)) {
		return yield* AppError.make({message: 'OAuth requires HTTPS outside loopback'})
	}
	const file = path.join(directory, `${encodeURIComponent(origin.origin)}-${encodeURIComponent(resource)}.json`)
	const discovery = yield* pipe(
		client.get(new URL('/.well-known/oauth-authorization-server/api/auth', origin).href),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(OAuthDiscovery))
	)
	if (
		discovery.issuer !== new URL('/api/auth', origin).href ||
		!Array.every(
			[discovery.authorization_endpoint, discovery.registration_endpoint, discovery.token_endpoint],
			url => new URL(url).origin === origin.origin
		)
	) {
		return yield* AppError.make({message: 'OAuth discovery changed the configured issuer or origin'})
	}
	const read = Effect.gen(function* () {
		if (!(yield* fs.exists(file))) return Option.none<Credentials>()
		return Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(Credentials))(yield* fs.readFileString(file)))
	})
	function exclusive<A, E, R>(effect: Effect.Effect<A, E, R>) {
		return Effect.scoped(
			Effect.gen(function* () {
				// Never steal a refresh lock: a replay can revoke the entire OAuth grant. A crashed owner leaves an explicit recovery error.
				yield* pipe(
					fs.open(`${file}.lock`, {flag: 'wx', mode: 0o600}),
					Effect.retry({
						schedule: Schedule.spaced('100 millis'),
						times: 100,
						while: error => error.reason._tag === 'AlreadyExists'
					}),
					Effect.mapError(cause =>
						AppError.make({
							cause,
							message: `OAuth credentials locked; if no other ${name} command is running, remove ${file}.lock`
						})
					)
				)
				yield* Effect.addFinalizer(() =>
					pipe(
						fs.remove(`${file}.lock`),
						Effect.ignore({
							log: 'Warn',
							message: 'Could not remove the OAuth refresh lock; remove it before signing in again'
						})
					)
				)
				return yield* effect
			})
		)
	}
	const exchange = Effect.fnUntraced(function* (clientId: string, params: Record<string, string>) {
		const response = yield* pipe(
			client.execute(
				pipe(
					HttpClientRequest.post(discovery.token_endpoint),
					HttpClientRequest.bodyUrlParams({
						...params,
						client_id: clientId,
						resource: [resource, new URL('/mcp', resource).href]
					})
				)
			),
			Effect.timeout('10 seconds')
		)
		const token = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
		const credentials = Credentials.make({
			accessToken: token.access_token,
			clientId,
			expiresAt: (yield* Clock.currentTimeMillis) + token.expires_in * 1000,
			refreshToken: token.refresh_token
		})
		yield* fs.writeFileString(
			`${file}.next`,
			yield* Schema.encodeEffect(Schema.fromJsonString(Credentials))(credentials),
			{mode: 0o600}
		)
		yield* fs.rename(`${file}.next`, file)
		return credentials.accessToken
	})
	return {
		login: Effect.scoped(
			Effect.gen(function* () {
				const random = yield* SecureRandom.SecureRandom
				const state = Base64Url.encode(yield* random.randomBytes(32))
				const verifier = Base64Url.encode(yield* random.randomBytes(32))
				const challenge = Base64Url.encode(
					yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(verifier))
				)
				const callback = yield* Deferred.make<string>()
				const server = yield* NodeHttpServer.make(createServer, {host: '127.0.0.1', port: 0})
				const redirect = `${HttpServer.formatAddress(server.address)}/callback`
				yield* server.serve(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest
						const url = new URL(request.url, redirect)
						if (
							request.method !== 'GET' ||
							url.pathname !== '/callback' ||
							url.searchParams.get('state') !== state ||
							url.searchParams.get('iss') !== discovery.issuer ||
							!url.searchParams.has('code')
						) {
							return HttpServerResponse.text('Invalid OAuth callback', {status: 400})
						}
						yield* Deferred.succeed(callback, url.searchParams.get('code') ?? '')
						return HttpServerResponse.text('Signed in. You can close this page.', {
							headers: {'cache-control': 'no-store', 'content-security-policy': "default-src 'none'"}
						})
					})
				)
				const registration = yield* pipe(
					HttpClientRequest.post(discovery.registration_endpoint),
					HttpClientRequest.bodyJson({
						application_type: 'native',
						client_name: `${name} CLI`,
						grant_types: ['authorization_code', 'refresh_token'],
						redirect_uris: [redirect],
						response_types: ['code'],
						token_endpoint_auth_method: 'none'
					}),
					Effect.flatMap(request => client.execute(request)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration))
				)
				const url = new URL(discovery.authorization_endpoint)
				url.search = new URLSearchParams({
					client_id: registration.client_id,
					code_challenge: challenge,
					code_challenge_method: 'S256',
					redirect_uri: redirect,
					resource,
					response_type: 'code',
					scope: 'deslop offline_access',
					state
				}).toString()
				url.searchParams.append('resource', new URL('/mcp', resource).href)
				yield* Stream.run(
					Stream.make(`Open this URL on this machine to sign in:\n${url.href}\n`),
					(yield* Stdio.Stdio).stderr()
				)
				yield* pipe(
					Deferred.await(callback),
					Effect.timeout('10 minutes'),
					Effect.flatMap(code =>
						pipe(
							exclusive(
								exchange(registration.client_id, {
									code,
									code_verifier: verifier,
									grant_type: 'authorization_code',
									redirect_uri: redirect
								})
							),
							Effect.uninterruptible
						)
					)
				)
			})
		),
		token: pipe(
			exclusive(
				Effect.gen(function* () {
					const saved = yield* pipe(
						Effect.fromOption(yield* read),
						Effect.mapError(cause =>
							AppError.make({cause, message: `Run ${name} login with the same --auth and --url first`})
						)
					)
					if (saved.expiresAt > (yield* Clock.currentTimeMillis) + 60_000) return saved.accessToken
					return yield* exchange(saved.clientId, {grant_type: 'refresh_token', refresh_token: saved.refreshToken})
				})
			),
			Effect.uninterruptible
		)
	}
})
