import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	Option,
	Order,
	Queue,
	Ref,
	Schema,
	String,
	Stream,
	pipe
} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {Digest, SecureRandom, Signature} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams} from 'effect/http'
import {Jwk, Jwks, Jwt} from 'effect/jose'
import {KeyValueStore, RateLimiter} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {AccessClaims, AuthError, TokenResponse, User} from '@deslop/runtime/auth/schema'
import {HttpAuth} from '@deslop/runtime/auth/service'
import {ACCESS_SECONDS, AUTH_URL, CurrentUser, JWKS_PATH, clientIdOf} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import {Apps} from '#services/apps/service.ts'
import {GitHub} from '#services/github/service.ts'
import {AddPasskeyParams, CreationOptions, Passkey, PasskeySignIn, RequestOptions} from '#services/passkeys/schema.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {AdmitParams, Person} from '#services/people/schema.ts'
import {People, layerIssuerAuth} from '#services/people/service.ts'
import {
	AnswerParams,
	AuthorizationStatus,
	CodeParams,
	PendingAuthorization,
	RequestParams
} from '#services/sign-ins/schema.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {DEVICE_GRANT, Registration, SessionVia, SignedInApp} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers, layerMcpOwner} from '#tools/handlers.ts'

const API = 'https://stash.mp281x.xyz'
const APPROVALS = 'https://auth.mp281x.xyz/mcp'
const GITHUB_IDS: Record<string, number> = {drifter: 9, octocat: 42, stranger: 7}
const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const VERIFIER = String.repeat(43)('x')
type FamilyParams = typeof FamilyParams.Type
const FamilyParams = Schema.Struct({family: Schema.NonEmptyString})
type PersonParams = typeof PersonParams.Type
const PersonParams = Schema.Struct({id: Schema.NonEmptyString})

const me = pipe(
	HttpRouter.add('GET', '/me', Effect.flatMap(CurrentUser, HttpServerResponse.schemaJson(User))),
	Layer.provide(HttpAuth.layer)
)

const mcp = pipe(
	McpServer.layerHttp({
		instructions:
			"Auth holds the user's sign-ins, passkeys and people; start with list_sessions, or answer_request when the user shows you a sign-in code.",
		name: 'Auth',
		path: '/mcp',
		protocols: [McpProtocol.v2025_06_18],
		registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers), Layer.provide(layerMcpOwner)),
		version: '1'
	}),
	Layer.provide(HttpAuth.layer)
)

const requestOwner = Effect.gen(function* () {
	return yield* (yield* Tokens).session((yield* HttpServerRequest.HttpServerRequest).headers)
})

function refused<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return Effect.catchIf(handler, Schema.is(AuthError), failure =>
		Effect.succeed(HttpServerResponse.text(failure.message, {status: 400}))
	)
}

const servers = Effect.fnUntraced(function* (saved?: string, failing?: Ref.Ref<Option.Option<string>>) {
	const directory = saved ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	const failures = failing ?? (yield* Ref.make(Option.none<string>()))
	const grantWrites = yield* Ref.make(0)
	const failGrantWrite = yield* Ref.make(Option.none<number>())
	const storage = pipe(
		Layer.effect(
			KeyValueStore.KeyValueStore,
			Effect.map(KeyValueStore.KeyValueStore, store =>
				KeyValueStore.make({
					...store,
					set: (key, value) =>
						Effect.gen(function* () {
							const grantFailed =
								key === 'sign-ins' &&
								Option.contains(
									yield* Ref.get(failGrantWrite),
									yield* Ref.updateAndGet(grantWrites, count => count + 1)
								)
							if (Option.contains(yield* Ref.get(failures), key) || grantFailed) {
								return yield* new KeyValueStore.KeyValueStoreError({key, message: 'Disk unavailable', method: 'set'})
							}
							return yield* store.set(key, value)
						})
				})
			)
		),
		Layer.provide(ServerRuntime.layerKeyValueStore(directory))
	)
	const digest = yield* Digest.Digest
	const clock = yield* Clock.Clock
	const ready = yield* Queue.make<true>()
	const github = HttpClient.make(request =>
		Effect.gen(function* () {
			if (
				!String.startsWith('https://github.com/')(request.url) &&
				!String.startsWith('https://api.github.com/')(request.url)
			) {
				return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
			}
			if (request.url === 'https://github.com/login/oauth/access_token' && request.body._tag === 'Uint8Array') {
				const form = new URLSearchParams(new TextDecoder().decode(request.body.body))
				const [login, challenge] = String.split(form.get('code') ?? '', '.')
				if (
					Base64Url.encode(
						yield* digest.digest(Digest.sha256, new TextEncoder().encode(form.get('code_verifier') ?? ''))
					) !== challenge
				) {
					return HttpClientResponse.fromWeb(request, Response.json({error: 'bad_verification_code'}))
				}
				return HttpClientResponse.fromWeb(request, Response.json({access_token: login}))
			}
			const login = String.replace('Bearer ', '')(request.headers['authorization'] ?? '')
			return HttpClientResponse.fromWeb(
				request,
				Response.json({id: GITHUB_IDS[login] ?? 1, login, name: `${login} example`})
			)
		})
	)
	const issuer = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						me,
						HttpHandlers,
						mcp,
						HttpRouter.add(
							'GET',
							'/auth/request',
							pipe(
								Effect.gen(function* () {
									const params = yield* HttpServerRequest.schemaSearchParams(RequestParams)
									return yield* HttpServerResponse.schemaJson(AuthorizationStatus)(
										yield* Effect.flatMap(
											Stream.runHead(
												(yield* SignIns).status(params.request, (yield* HttpServerRequest.HttpServerRequest).headers)
											),
											Effect.fromOption
										)
									)
								}),
								Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
							)
						),
						pipe(
							Layer.mergeAll(
								HttpRouter.add(
									'GET',
									'/people',
									pipe(
										Effect.gen(function* () {
											return yield* HttpServerResponse.schemaJson(Schema.Array(Person))(
												yield* (yield* People).list(yield* CurrentUser)
											)
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/admit',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AdmitParams)
											yield* (yield* People).admit(input, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/remove-person',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(PersonParams)
											yield* (yield* People).remove(input.id, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/apps',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(SignedInApp))(
											yield* Effect.flatMap(
												Stream.runHead((yield* Tokens).apps(yield* requestOwner)),
												Effect.fromOption
											)
										)
									})
								),
								HttpRouter.add(
									'POST',
									'/disconnect',
									pipe(
										Effect.gen(function* () {
											const params = yield* HttpServerRequest.schemaSearchParams(FamilyParams)
											yield* (yield* Tokens).disconnect(params.family, yield* requestOwner)
											return HttpServerResponse.empty()
										}),
										Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
									)
								),
								HttpRouter.add(
									'GET',
									'/passkey-options',
									pipe(
										Effect.gen(function* () {
											return yield* HttpServerResponse.schemaJson(CreationOptions)(
												yield* (yield* Passkeys).registration(
													yield* requestOwner,
													yield* (yield* Tokens).sessionVia((yield* HttpServerRequest.HttpServerRequest).headers)
												)
											)
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/add-passkey',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AddPasskeyParams)
											yield* (yield* Passkeys).add(input.response, {
												from: {userAgent: IPHONE_SAFARI},
												owner: yield* requestOwner,
												via: yield* (yield* Tokens).sessionVia((yield* HttpServerRequest.HttpServerRequest).headers)
											})
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/passkeys',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(Passkey))(
											yield* Effect.flatMap(
												Stream.runHead((yield* Passkeys).list(yield* requestOwner)),
												Effect.fromOption
											)
										)
									})
								),
								HttpRouter.add(
									'POST',
									'/answer',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AnswerParams)
											yield* (yield* SignIns).answer(input, yield* requestOwner, 'Session')
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/lookup',
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CodeParams)
										return yield* HttpServerResponse.schemaJson(Schema.Array(PendingAuthorization))(
											Option.toArray(
												yield* Effect.flatMap(Stream.runHead((yield* SignIns).lookup(params.code)), Effect.fromOption)
											)
										)
									})
								),
								HttpRouter.add(
									'GET',
									'/events',
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CodeParams)
										return HttpServerResponse.stream(
											pipe(
												(yield* SignIns).lookup(params.code),
												Stream.take(2),
												Stream.mapEffect((found, index) =>
													Effect.gen(function* () {
														if (index === 0) yield* Queue.offer(ready, true)
														return yield* Schema.encodeEffect(
															Schema.fromJsonString(Schema.Array(PendingAuthorization))
														)(Option.toArray(found))
													})
												),
												Stream.map(value => new TextEncoder().encode(`${value}\n`))
											)
										)
									})
								)
							),
							Layer.provide(HttpAuth.layer)
						)
					),
					Layer.provideMerge(layerIssuerAuth),
					Layer.provideMerge(
						Layer.mergeAll(SignIns.layer, Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory))
					),
					Layer.provideMerge(People.layer),
					Layer.provideMerge(Layer.mergeAll(Tokens.layer, Passkeys.layer, GitHub.layer, Apps.layer)),
					Layer.provide(storage),
					Layer.provide(
						Layer.mergeAll(
							NodeCrypto.layer,
							NodeServices.layer,
							Layer.succeed(HttpClient.HttpClient, github),
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({
									APP_URL: AUTH_URL,
									AUTH_URL,
									GITHUB_ADMINS: '42',
									GITHUB_CLIENT_ID: 'example',
									GITHUB_CLIENT_SECRET: 'example'
								})
							)
						)
					),
					Layer.provideMerge(Layer.succeed(Clock.Clock, clock))
				),
				{disableLogger: true}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
	return {failGrantWrite, grantWrites, issuer, ready}
})

function send(web: Effect.Success<ReturnType<typeof servers>>['issuer'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, AUTH_URL), init)))
}

function cookie(response: Response) {
	return pipe(
		response.headers.getSetCookie(),
		Array.map(value => Array.headNonEmpty(String.split(value, ';'))),
		Array.join('; ')
	)
}

const signIn = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	login: string,
	search = '',
	previous = ''
) {
	const start = yield* send(web, `/auth/github${search}`)
	const target = new URL(start.headers.get('location') ?? '')
	return yield* send(
		web,
		`/auth/github/callback?${UrlParams.toString(
			UrlParams.fromInput({
				code: `${login}.${target.searchParams.get('code_challenge') ?? ''}`,
				state: target.searchParams.get('state') ?? ''
			})
		)}`,
		{headers: {cookie: `${cookie(start)}; ${previous}`}}
	)
})

const authorize = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string,
	redirect: string,
	resource: string[]
) {
	const registered = yield* send(web, '/api/auth/oauth2/register', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Registration))({
			client_name: 'opencode',
			redirect_uris: [redirect],
			token_endpoint_auth_method: 'none'
		}),
		headers: {'content-type': 'application/json'},
		method: 'POST'
	})
	assert.strictEqual(registered.status, 201)
	const registration = yield* Schema.decodeEffect(
		Schema.fromJsonString(Schema.Struct({client_id: Schema.NonEmptyString}))
	)(yield* Effect.promise(() => registered.text()))
	const request = yield* send(
		web,
		`/api/auth/oauth2/authorize?${UrlParams.toString(
			UrlParams.fromInput({
				client_id: registration.client_id,
				code_challenge: Base64Url.encode(
					yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
				),
				code_challenge_method: 'S256',
				redirect_uri: redirect,
				resource,
				response_type: 'code',
				scope: 'deslop offline_access',
				state: 'example-state'
			})
		)}`
	)
	assert.strictEqual(request.status, 302)
	return {
		clientId: registration.client_id,
		cookie: pipe([session, cookie(request)], Array.filter(String.isNonEmpty), Array.join('; ')),
		id: new URL(request.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? '',
		redirect
	}
})

const answer = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string,
	request: string,
	accept: boolean
) {
	return yield* send(web, '/answer', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(AnswerParams))({accept, request}),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
})

const delivered = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: {cookie: string; id: string}
) {
	const response = yield* send(web, `/auth/continue?request=${request.id}`, {headers: {cookie: request.cookie}})
	assert.strictEqual(response.status, 302)
	return new URL(response.headers.get('location') ?? '', AUTH_URL)
})

const consent = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	accept: boolean
) {
	assert.strictEqual((yield* answer(web, request.cookie, request.id, accept)).status, 204)
	return yield* delivered(web, request)
})

const callTool = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	token: string,
	name: string,
	input: Record<string, unknown>
) {
	const headers = {
		accept: 'application/json, text/event-stream',
		authorization: `Bearer ${token}`,
		'content-type': 'application/json',
		'mcp-protocol-version': '2025-06-18'
	}
	const opened = yield* send(web, '/mcp', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			id: 1,
			jsonrpc: '2.0',
			method: 'initialize',
			params: {capabilities: {}, clientInfo: {name: 'agent', version: '1'}, protocolVersion: '2025-06-18'}
		}),
		headers,
		method: 'POST'
	})
	if (opened.status !== 200) return opened
	return yield* send(web, '/mcp', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			id: 2,
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {arguments: input, name}
		}),
		headers: {...headers, 'mcp-session-id': opened.headers.get('mcp-session-id') ?? ''},
		method: 'POST'
	})
})

// The structured answer of a tool call that succeeded.
const toolResult = Effect.fnUntraced(function* (response: Response) {
	return (yield* Schema.decodeEffect(
		Schema.fromJsonString(Schema.Struct({result: Schema.Struct({structuredContent: Schema.Unknown})}))
	)(yield* Effect.promise(() => response.text()))).result.structuredContent
})

const exchange = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	code: string,
	forwardedFor: string = '93.184.216.34'
) {
	return yield* send(web, '/api/auth/oauth2/token', {
		body: UrlParams.toString(
			UrlParams.fromInput({
				client_id: request.clientId,
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: request.redirect,
				resource: 'https://scope.mp281x.xyz/mcp'
			})
		),
		headers: {'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': forwardedFor},
		method: 'POST'
	})
})

function formPost(params: Record<string, string>) {
	return {
		body: UrlParams.toString(UrlParams.fromInput(params)),
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	}
}

const refresh = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	clientId: string,
	token: string
) {
	return yield* send(web, '/api/auth/oauth2/token', {
		body: UrlParams.toString(
			UrlParams.fromInput({client_id: clientId, grant_type: 'refresh_token', refresh_token: token})
		),
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	})
})

const agentToken = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string
) {
	const agent = yield* authorize(web, session, 'http://127.0.0.1:34569/callback', [APPROVALS])
	const granted = yield* exchange(web, agent, (yield* consent(web, agent, true)).searchParams.get('code') ?? '')
	return (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(yield* Effect.promise(() => granted.text())))
		.access_token
})

const post = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	path: string,
	session: string,
	body: unknown
) {
	return yield* send(web, path, {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
})

const people = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string
) {
	const response = yield* send(web, '/people', {headers: {cookie: session}})
	return Array.map(
		yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Person)))(
			yield* Effect.promise(() => response.text())
		),
		person => `${person.name}:${person.role}`
	)
})

// An unsigned big-endian number as a DER INTEGER: leading zeros dropped, one put back where the top bit would read as a sign.
function derInteger(half: readonly number[]) {
	const trimmed = Array.dropWhile(half, byte => byte === 0)
	const value = Boolean.match(
		Option.exists(Array.head(trimmed), byte => byte >= 0x80),
		{onFalse: () => trimmed, onTrue: () => [0, ...trimmed]}
	)
	return [0x02, value.length, ...value]
}

// Signature signs ECDSA as r‖s; WebAuthn carries the DER form.
function der(raw: Uint8Array) {
	const bytes = Array.fromIterable(raw)
	const body = [...derInteger(Array.take(bytes, 32)), ...derInteger(Array.drop(bytes, 32))]
	return Uint8Array.of(0x30, body.length, ...body)
}

// A CBOR byte string of 24 to 255 bytes, as every one here is: its head, its length, then its bytes.
function cborBytes(bytes: Uint8Array) {
	return Uint8Array.of(0x58, bytes.length, ...bytes)
}

function cborText(text: string) {
	const bytes = new TextEncoder().encode(text)
	return Uint8Array.of(0x60 + bytes.length, ...bytes)
}

function clientData(type: string, challenge: string) {
	return new TextEncoder().encode(
		Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({challenge, crossOrigin: false, origin: AUTH_URL, type})
	)
}

const authenticator = Effect.fnUntraced(function* () {
	const signature = yield* Signature.Signature
	const digest = yield* Digest.Digest
	const keys = yield* signature.generateKeyPair(Signature.ecdsaP256)
	// The uncompressed point: 0x04, then x and y.
	const point = Array.fromIterable(yield* Signature.toBytes(keys.publicKey))
	const credential = yield* (yield* SecureRandom.SecureRandom).randomBytes(16)
	const id = Base64Url.encode(credential)
	// The relying party's hash, then flags (user present 0x01, verified 0x04, attested credential 0x40), a zero counter, then any attested credential.
	const authData = Effect.fnUntraced(function* (rpId: string, flags: number, attested: readonly number[]) {
		return Uint8Array.of(
			...(yield* digest.digest(Digest.sha256, new TextEncoder().encode(rpId))),
			flags,
			0,
			0,
			0,
			0,
			...attested
		)
	})
	return {
		answer: Effect.fnUntraced(function* (options: RequestOptions) {
			const data = clientData('webauthn.get', options.challenge)
			const authenticatorData = yield* authData(options.rpId ?? '', 0x05, [])
			const signed = yield* signature.sign(
				keys.privateKey,
				Uint8Array.of(...authenticatorData, ...(yield* digest.digest(Digest.sha256, data)))
			)
			return {
				clientExtensionResults: {},
				id,
				rawId: id,
				response: {
					authenticatorData: Base64Url.encode(authenticatorData),
					clientDataJSON: Base64Url.encode(data),
					signature: Base64Url.encode(der(signed))
				},
				type: 'public-key'
			} satisfies PasskeySignIn['response']
		}),
		register: Effect.fnUntraced(function* (options: CreationOptions) {
			// COSE EC2 key, ES256 on P-256: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
			const key = [
				0xa5,
				0x01,
				0x02,
				0x03,
				0x26,
				0x20,
				0x01,
				0x21,
				...cborBytes(Uint8Array.from(Array.take(Array.drop(point, 1), 32))),
				0x22,
				...cborBytes(Uint8Array.from(Array.drop(point, 33)))
			]
			// A zero AAGUID, the credential id's length and the id, then its public key.
			const attested = [...Array.replicate(0, 16), 0, credential.length, ...credential, ...key]
			return {
				clientExtensionResults: {},
				id,
				rawId: id,
				response: {
					attestationObject: Base64Url.encode(
						Uint8Array.of(
							0xa3,
							...cborText('fmt'),
							...cborText('none'),
							...cborText('attStmt'),
							0xa0,
							...cborText('authData'),
							...cborBytes(yield* authData(options.rp.id ?? '', 0x45, attested))
						)
					),
					clientDataJSON: Base64Url.encode(clientData('webauthn.create', options.challenge)),
					transports: ['usb']
				},
				type: 'public-key'
			} satisfies AddPasskeyParams['response']
		})
	}
})

const replacement = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	previous: string,
	via: SessionVia
) {
	if (via === 'GitHub') return () => signIn(web, 'octocat', '', previous)
	if (via === 'Code') {
		const started = yield* send(web, '/auth/code', {headers: {cookie: previous}})
		const id = new URL(started.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? ''
		assert.strictEqual((yield* answer(web, previous, id, true)).status, 204)
		return () => send(web, `/auth/continue?request=${id}`, {headers: {cookie: `${cookie(started)}; ${previous}`}})
	}
	const key = yield* authenticator()
	const options = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
		yield* Effect.flatMap(send(web, '/passkey-options', {headers: {cookie: previous}}), response =>
			Effect.promise(() => response.text())
		)
	)
	assert.strictEqual((yield* post(web, '/add-passkey', previous, {response: yield* key.register(options)})).status, 204)
	return Effect.fnUntraced(function* () {
		const asked = yield* Schema.decodeEffect(Schema.fromJsonString(RequestOptions))(
			yield* Effect.flatMap(send(web, '/auth/passkey'), response => Effect.promise(() => response.text()))
		)
		return yield* post(web, '/auth/passkey', previous, {response: yield* key.answer(asked)})
	})
})

const authorizeWeb = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string
) {
	const redirect = 'https://scope.mp281x.xyz/auth/callback'
	const clientId = clientIdOf({name: 'Scope', redirects: [redirect]})
	const path = `/api/auth/oauth2/authorize?${UrlParams.toString(
		UrlParams.fromInput({
			client_id: clientId,
			code_challenge: Base64Url.encode(
				yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
			),
			code_challenge_method: 'S256',
			redirect_uri: redirect,
			response_type: 'code',
			scope: 'deslop offline_access',
			state: 'web-state'
		})
	)}`
	return {
		clientId,
		cookie: session,
		id: '',
		path,
		redirect,
		response: yield* send(web, path, {headers: {cookie: session}})
	}
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))(test => {
	test.effect(
		'redirects first-party web authorization through Auth and answers immediately after sign-in',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const request = yield* authorizeWeb(web.issuer, '')
			const signInPage = new URL(request.response.headers.get('location') ?? '', AUTH_URL)
			assert.strictEqual(signInPage.pathname, '/')
			assert.strictEqual(signInPage.searchParams.get('next'), new URL(request.path, AUTH_URL).href)
			assert.isFalse(signInPage.searchParams.has('request'))
			const signedIn = yield* signIn(
				web.issuer,
				'octocat',
				`?${new URLSearchParams({next: signInPage.searchParams.get('next') ?? ''})}`
			)
			assert.strictEqual(signedIn.headers.get('location'), new URL(request.path, AUTH_URL).href)
			const setCookie = signedIn.headers.getSetCookie()
			assert.isTrue(
				Array.some(
					setCookie,
					value =>
						String.startsWith('__Host-session=')(value) &&
						String.includes('HttpOnly')(value) &&
						String.includes('Secure')(value) &&
						String.includes('SameSite=Lax')(value) &&
						String.includes('Path=/')(value)
				)
			)
			assert.isFalse(Array.some(setCookie, value => String.includes('Domain=')(value)))
			const response = yield* send(web.issuer, request.path, {headers: {cookie: cookie(signedIn)}})
			const callback = new URL(response.headers.get('location') ?? '')
			assert.strictEqual(`${callback.origin}${callback.pathname}`, request.redirect)
			assert.strictEqual(callback.searchParams.get('state'), 'web-state')
			assert.strictEqual(callback.searchParams.get('iss'), `${AUTH_URL}/api/auth`)
			assert.isTrue(String.isNonEmpty(callback.searchParams.get('code') ?? ''))
			assert.isEmpty(response.headers.getSetCookie())
			assert.strictEqual((yield* exchange(web.issuer, request, callback.searchParams.get('code') ?? '')).status, 200)
		})
	)

	test.effect(
		'serves public signing keys that verify ten-minute tokens for every Deslop app',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const request = yield* authorizeWeb(web.issuer, cookie(yield* signIn(web.issuer, 'octocat')))
			const response = yield* exchange(
				web.issuer,
				request,
				new URL(request.response.headers.get('location') ?? '').searchParams.get('code') ?? ''
			)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => response.text())
			)
			const keys = yield* send(web.issuer, JWKS_PATH)
			assert.strictEqual(keys.headers.get('cache-control'), 'public, max-age=300')
			const jwks = yield* Schema.decodeEffect(Schema.fromJsonString(Jwks.KeySet))(
				yield* Effect.promise(() => keys.text())
			)
			assert.strictEqual(jwks.keys.length, 1)
			const verified = yield* Effect.provideService(
				Jwt.verifyWithKeySet(AccessClaims, token.access_token, {
					algorithms: ['EdDSA'],
					audience: 'deslop',
					issuer: `${AUTH_URL}/api/auth`,
					typ: 'at+jwt'
				}),
				Jwks.Jwks,
				yield* Jwks.makeLocal(jwks)
			)
			assert.deepStrictEqual(verified.claims, {
				aud: 'deslop',
				azp: 'Scope',
				exp: verified.claims.iat + ACCESS_SECONDS,
				iat: verified.claims.iat,
				iss: `${AUTH_URL}/api/auth`,
				name: 'octocat',
				sid: Array.headNonEmpty(String.split(token.refresh_token, '.')),
				sub: 'github:42'
			})
			assert.strictEqual(
				verified.protectedHeader.kid,
				yield* Jwk.thumbprint(
					yield* Schema.decodeUnknownEffect(Jwk.PublicJwk)(yield* Effect.fromOption(Array.head(jwks.keys)))
				)
			)
			const metadata = yield* send(web.issuer, '/.well-known/oauth-authorization-server/api/auth')
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({issuer: Schema.String, jwks_uri: Schema.String}))
				)(yield* Effect.promise(() => metadata.text())),
				{issuer: `${AUTH_URL}/api/auth`, jwks_uri: `${AUTH_URL}${JWKS_PATH}`}
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				200
			)
			assert.strictEqual(
				(yield* send((yield* servers()).issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}}))
					.status,
				401
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: 'Basic invalid', cookie: request.cookie}})).status,
				401
			)
			yield* TestClock.adjust('10 minutes')
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				401
			)
		})
	)

	test.effect(
		'refuses first-party authorization for an account awaiting admission',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const callback = new URL(
				(yield* authorizeWeb(web.issuer, cookie(yield* signIn(web.issuer, 'stranger')))).response.headers.get(
					'location'
				) ?? ''
			)
			assert.strictEqual(callback.searchParams.get('error'), 'access_denied')
			assert.isFalse(callback.searchParams.has('code'))
		})
	)

	for (const ending of ['sign-out', 'disconnect', 'replacement'] as const) {
		test.effect(
			`ends a browser's child grants on ${ending} without ending independent sign-ins`,
			Effect.fnUntraced(function* () {
				const web = yield* servers()
				const session = cookie(yield* signIn(web.issuer, 'octocat'))
				const independent = yield* agentToken(web.issuer, session)
				const request = yield* authorizeWeb(web.issuer, session)
				const response = yield* exchange(
					web.issuer,
					request,
					new URL(request.response.headers.get('location') ?? '').searchParams.get('code') ?? ''
				)
				const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
					yield* Effect.promise(() => response.text())
				)
				const list = yield* send(web.issuer, '/apps', {headers: {cookie: session}})
				const apps = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
					yield* Effect.promise(() => list.text())
				)
				const browser = yield* Effect.fromOption(Array.findFirst(apps, app => app.kind === 'Browser'))
				assert.strictEqual(
					(yield* Effect.fromOption(Array.findFirst(apps, app => app.client === 'Scope'))).parent,
					browser.family
				)
				const unspent = yield* authorizeWeb(web.issuer, session)
				if (ending === 'sign-out') {
					assert.strictEqual(
						(yield* send(web.issuer, '/auth/sign-out', {headers: {cookie: session}, method: 'POST'})).status,
						204
					)
				} else if (ending === 'disconnect') {
					assert.strictEqual(
						(yield* send(web.issuer, `/disconnect?family=${browser.family}`, {
							headers: {cookie: session},
							method: 'POST'
						})).status,
						204
					)
				} else {
					yield* signIn(web.issuer, 'octocat', '', session)
				}
				assert.strictEqual(
					(yield* exchange(
						web.issuer,
						unspent,
						new URL(unspent.response.headers.get('location') ?? '').searchParams.get('code') ?? ''
					)).status,
					400
				)
				assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 400)
				assert.strictEqual(
					(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
					401
				)
				assert.strictEqual(
					(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${independent}`}})).status,
					200
				)
			})
		)
	}

	test.effect(
		'registers a credential ID to only one account under concurrent verified requests',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const member = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const key = yield* authenticator()
			const attempts = yield* Effect.forEach(
				[admin, member],
				Effect.fnUntraced(function* (session) {
					const options = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
						yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: session}}), response =>
							Effect.promise(() => response.text())
						)
					)
					return {response: yield* key.register(options), session}
				}),
				{concurrency: 'unbounded'}
			)
			const responses = yield* Effect.forEach(
				attempts,
				attempt => post(web.issuer, '/add-passkey', attempt.session, {response: attempt.response}),
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(
				Array.sort(
					Array.map(responses, response => response.status),
					Order.Number
				),
				[204, 400]
			)
			const listed = yield* Effect.forEach(
				[admin, member],
				Effect.fnUntraced(function* (session) {
					return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Passkey)))(
						yield* Effect.flatMap(send(web.issuer, '/passkeys', {headers: {cookie: session}}), response =>
							Effect.promise(() => response.text())
						)
					)
				}),
				{concurrency: 'unbounded'}
			)
			assert.strictEqual(Array.flatten(listed).length, 1)
			const challenge = yield* Schema.decodeEffect(Schema.fromJsonString(RequestOptions))(
				yield* Effect.flatMap(send(web.issuer, '/auth/passkey'), response => Effect.promise(() => response.text()))
			)
			const session = cookie(yield* post(web.issuer, '/auth/passkey', '', {response: yield* key.answer(challenge)}))
			assert.strictEqual(
				(yield* Schema.decodeEffect(Schema.fromJsonString(User))(
					yield* Effect.flatMap(send(web.issuer, '/me', {headers: {cookie: session}}), response =>
						Effect.promise(() => response.text())
					)
				)).id,
				Boolean.match(responses[0]?.status === 204, {onFalse: () => 'github:7', onTrue: () => 'github:42'})
			)
		})
	)

	test.effect(
		'keeps old passkeys and registration challenges invalid after a failed removal cleanup and restart',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const failing = yield* Ref.make(Option.none<string>())
			const web = yield* servers(directory, failing)
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const member = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const key = yield* authenticator()
			const options = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: member}}), response =>
					Effect.promise(() => response.text())
				)
			)
			assert.strictEqual(
				(yield* post(web.issuer, '/add-passkey', member, {response: yield* key.register(options)})).status,
				204
			)
			const pending = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: member}}), response =>
					Effect.promise(() => response.text())
				)
			)
			yield* Ref.set(failing, Option.some('sign-ins'))
			assert.strictEqual((yield* post(web.issuer, '/remove-person', admin, {id: 'github:7'})).status, 400)
			yield* Ref.set(failing, Option.none())
			const fresh = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const anotherKey = yield* authenticator()
			// The old challenge cannot be used by the account's new registration, even before restart.
			assert.strictEqual(
				(yield* post(web.issuer, '/add-passkey', fresh, {response: yield* anotherKey.register(pending)})).status,
				400
			)
			const restarted = yield* servers(directory)
			const challenge = yield* Schema.decodeEffect(Schema.fromJsonString(RequestOptions))(
				yield* Effect.flatMap(send(restarted.issuer, '/auth/passkey'), response =>
					Effect.promise(() => response.text())
				)
			)
			assert.strictEqual(
				(yield* post(restarted.issuer, '/auth/passkey', '', {response: yield* key.answer(challenge)})).status,
				400
			)
			assert.deepStrictEqual(
				yield* Effect.flatMap(send(restarted.issuer, '/passkeys', {headers: {cookie: fresh}}), response =>
					Effect.promise(() => response.json())
				),
				[]
			)
			assert.strictEqual((yield* send(restarted.issuer, '/me', {headers: {cookie: fresh}})).status, 200)
		})
	)

	test.effect(
		'adds a passkey of any kind while signed in, then signs a browser in with it alone, once per challenge',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const key = yield* authenticator()
			const json = {'content-type': 'application/json'}
			const options = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: session}}), response =>
					Effect.promise(() => response.text())
				)
			)
			// Discoverable and verified, with no attachment named, so a phone, a password manager and a security key all qualify.
			assert.deepStrictEqual(options.authenticatorSelection, {
				requireResidentKey: true,
				residentKey: 'required',
				userVerification: 'required'
			})
			assert.strictEqual(options.rp.id, 'mp281x.xyz')
			const added = yield* send(web.issuer, '/add-passkey', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(AddPasskeyParams))({
					response: yield* key.register(options)
				}),
				headers: {...json, cookie: session},
				method: 'POST'
			})
			assert.strictEqual(added.status, 204)
			const listed = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Passkey)))(
				yield* Effect.flatMap(send(web.issuer, '/passkeys', {headers: {cookie: session}}), response =>
					Effect.promise(() => response.text())
				)
			)
			assert.deepStrictEqual(
				Array.map(listed, passkey => [passkey.addedFrom, passkey.synced]),
				[['Safari · iPhone', false]]
			)
			const challenge = yield* Schema.decodeEffect(Schema.fromJsonString(RequestOptions))(
				yield* Effect.flatMap(send(web.issuer, '/auth/passkey'), response => Effect.promise(() => response.text()))
			)
			assert.isUndefined(challenge.allowCredentials)
			const assertion = yield* key.answer(challenge)
			const body = yield* Schema.encodeEffect(Schema.fromJsonString(PasskeySignIn))({
				next: `${API}/notes`,
				response: assertion
			})
			const signedIn = yield* send(web.issuer, '/auth/passkey', {body, headers: json, method: 'POST'})
			assert.strictEqual(signedIn.status, 200)
			assert.deepStrictEqual(yield* Effect.promise(() => signedIn.json()), {next: `${API}/notes`})
			assert.deepStrictEqual(
				yield* Effect.flatMap(send(web.issuer, '/me', {headers: {cookie: cookie(signedIn)}}), response =>
					Effect.promise(() => response.json())
				),
				{id: 'github:42', name: 'octocat'}
			)
			// The same answer again finds its challenge spent.
			assert.strictEqual((yield* send(web.issuer, '/auth/passkey', {body, headers: json, method: 'POST'})).status, 400)
			// A passkey's session may add another, but never one whose id is already registered.
			const passkeySession = cookie(signedIn)
			const repeat = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: passkeySession}}), response =>
					Effect.promise(() => response.text())
				)
			)
			const duplicate = yield* send(web.issuer, '/add-passkey', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(AddPasskeyParams))({
					response: yield* key.register(repeat)
				}),
				headers: {...json, cookie: passkeySession},
				method: 'POST'
			})
			assert.strictEqual(yield* Effect.promise(() => duplicate.text()), 'This passkey is already added')
			// A code-approved session may be someone else's browser, so it cannot mint a year-long passkey.
			const started = yield* send(web.issuer, '/auth/code')
			const request = new URL(started.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? ''
			yield* answer(web.issuer, session, request, true)
			const byCode = cookie(
				yield* send(web.issuer, `/auth/continue?request=${request}`, {headers: {cookie: cookie(started)}})
			)
			assert.strictEqual(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: byCode}}), response =>
					Effect.promise(() => response.text())
				),
				'Sign in with GitHub or a passkey on this browser to add a passkey'
			)
			assert.strictEqual(
				(yield* callTool(web.issuer, yield* agentToken(web.issuer, session), 'remove_passkey', {id: assertion.id}))
					.status,
				200
			)
			const again = yield* Schema.decodeEffect(Schema.fromJsonString(RequestOptions))(
				yield* Effect.flatMap(send(web.issuer, '/auth/passkey'), response => Effect.promise(() => response.text()))
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/passkey', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(PasskeySignIn))({response: yield* key.answer(again)}),
					headers: json,
					method: 'POST'
				})).status,
				400
			)
		})
	)

	test.effect(
		'keeps sessions, rotated tokens and revocations across restarts',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const saved = yield* Effect.scoped(
				Effect.gen(function* () {
					const web = yield* servers(home)
					const session = cookie(yield* signIn(web.issuer, 'octocat'))
					const request = yield* authorize(web.issuer, session, 'opm://auth/callback', [API])
					const response = yield* exchange(
						web.issuer,
						request,
						(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
					)
					const first = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => response.text())
					)
					const rotated = yield* refresh(web.issuer, request.clientId, first.refresh_token)
					const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => rotated.text())
					)
					return {clientId: request.clientId, first, session, token}
				})
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const web = yield* servers(home)
					assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: saved.session}})).status, 200)
					assert.strictEqual(
						(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${saved.token.access_token}`}})).status,
						200
					)
					assert.strictEqual((yield* refresh(web.issuer, saved.clientId, saved.first.refresh_token)).status, 400)
				})
			)
			const web = yield* servers(home)
			assert.strictEqual((yield* refresh(web.issuer, saved.clientId, saved.token.refresh_token)).status, 400)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${saved.token.access_token}`}})).status,
				401
			)
		})
	)

	test.effect(
		'approves from a separate session while only the originating browser receives the callback',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const first = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const second = yield* authorize(web.issuer, '', 'http://127.0.0.1:34568/callback', [
				'https://stash.mp281x.xyz/mcp'
			])
			assert.strictEqual((yield* send(web.issuer, `/lookup?code=${first.id}`)).status, 401)
			const lookup = Effect.fnUntraced(function* (code: string) {
				const response = yield* send(web.issuer, `/lookup?code=${code}`, {headers: {cookie: session}})
				const body = yield* Effect.promise(() => response.text())
				return {
					body,
					ids: Array.map(
						yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(body),
						item => item.id
					)
				}
			})
			const found = yield* lookup(String.toLowerCase(`${String.slice(0, 4)(first.id)}-${String.slice(4)(first.id)}`))
			assert.isFalse(String.includes('example-state')(found.body))
			assert.isFalse(String.includes('challenge')(found.body))
			assert.isFalse(String.includes(first.clientId)(found.body))
			// One code reads one sign-in: the other waiting one stays out of the answer, and an unknown code reads nothing.
			assert.deepStrictEqual(found.ids, [first.id])
			assert.deepStrictEqual((yield* lookup('BCDFGHJK')).ids, [])
			// A phone that opens the approve link signed out keeps the code through GitHub sign-in.
			assert.strictEqual(
				(yield* signIn(web.issuer, 'octocat', `?code=${first.id}`)).headers.get('location'),
				`/?code=${first.id}`
			)
			assert.strictEqual((yield* signIn(web.issuer, 'octocat')).headers.get('location'), '/')
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/request?request=${first.id}`, {headers: {cookie: session}})).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/request?request=${second.id}`, {headers: {cookie: first.cookie}})).status,
				400
			)
			assert.strictEqual((yield* answer(web.issuer, session, first.id, true)).status, 204)
			const decided = yield* send(web.issuer, `/auth/request?request=${first.id}`, {
				headers: {cookie: `${first.cookie}; ${second.cookie}`}
			})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => decided.text())
				),
				{_tag: 'Decided'}
			)
			// Only the browser holding the sign-in's cookie collects the answer, and only once.
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/continue?request=${first.id}`, {headers: {cookie: session}})).status,
				400
			)
			const callback = yield* delivered(web.issuer, {cookie: `${first.cookie}; ${second.cookie}`, id: first.id})
			assert.strictEqual(callback.origin, 'http://127.0.0.1:34567')
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/continue?request=${first.id}`, {headers: {cookie: first.cookie}})).status,
				400
			)
			assert.strictEqual((yield* exchange(web.issuer, first, callback.searchParams.get('code') ?? '')).status, 200)
			const waiting = yield* send(web.issuer, `/auth/request?request=${second.id}`, {
				headers: {cookie: `${first.cookie}; ${second.cookie}`}
			})
			assert.strictEqual(
				(yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => waiting.text())
				))._tag,
				'Waiting'
			)
		})
	)

	test.effect(
		'streams a typed code until its sign-in expires and rejects decisions after expiry',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const expirations = yield* pipe(
				send(web.issuer, `/events?code=${request.id}`, {headers: {cookie: session}}),
				Effect.flatMap(response => Effect.promise(() => response.text())),
				Effect.forkScoped
			)
			yield* Queue.take(web.ready)
			yield* TestClock.adjust('601 seconds')
			const expired = yield* Effect.forEach(
				pipe(yield* Fiber.join(expirations), String.trim, String.split('\n')),
				line => Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(line),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map(expired, snapshot => Array.map(snapshot, item => item.id)),
				[[request.id], []]
			)
			const receiver = yield* send(web.issuer, `/auth/request?request=${request.id}`, {
				headers: {cookie: request.cookie}
			})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => receiver.text())
				),
				{_tag: 'Expired'}
			)
			assert.strictEqual((yield* answer(web.issuer, session, request.id, true)).status, 400)
		})
	)

	test.effect(
		'accepts one decision across concurrent approving and denying sessions',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const first = cookie(yield* signIn(web.issuer, 'octocat'))
			const second = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const responses = yield* Effect.forEach(
				[
					{accept: true, session: first},
					{accept: false, session: second}
				],
				decision => answer(web.issuer, decision.session, request.id, decision.accept),
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(
				Array.sort(
					Array.map(responses, response => response.status),
					Order.Number
				),
				[204, 400]
			)
			const pending = yield* send(web.issuer, `/lookup?code=${request.id}`, {headers: {cookie: first}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(
					yield* Effect.promise(() => pending.text())
				),
				[]
			)
		})
	)

	test.effect(
		'returns a web sign-in to the page that started it only on its own domain, after any approve link',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const landing = Effect.fnUntraced(function* (search: Record<string, string>) {
				return (yield* signIn(
					web.issuer,
					'octocat',
					`?${UrlParams.toString(UrlParams.fromInput(search))}`
				)).headers.get('location')
			})
			assert.deepStrictEqual(
				[
					yield* landing({next: 'https://stash.mp281x.xyz/?invite=abc'}),
					yield* landing({next: 'https://evil.test/'}),
					yield* landing({next: 'http://stash.mp281x.xyz/'}),
					yield* landing({code: 'WDJB-MJHT', next: 'https://stash.mp281x.xyz/'}),
					yield* landing({})
				],
				['https://stash.mp281x.xyz/?invite=abc', '/', '/', '/?code=WDJB-MJHT', '/']
			)
		})
	)

	for (const via of SessionVia.literals) {
		test.effect(
			`replaces only the presented browser session in one grant write through ${via}`,
			Effect.fnUntraced(function* () {
				const web = yield* servers()
				const before = cookie(yield* signIn(web.issuer, 'octocat'))
				const independent = cookie(yield* signIn(web.issuer, 'octocat'))
				const replace = yield* replacement(web.issuer, before, via)
				const writes = yield* Ref.get(web.grantWrites)
				const after = cookie(yield* replace())
				assert.deepStrictEqual(
					[
						(yield* send(web.issuer, '/me', {headers: {cookie: before}})).status,
						(yield* send(web.issuer, '/me', {headers: {cookie: after}})).status,
						(yield* send(web.issuer, '/me', {headers: {cookie: independent}})).status
					],
					[401, 200, 200]
				)
				assert.strictEqual(yield* Ref.get(web.grantWrites), writes + 1)
			})
		)

		test.effect(
			`preserves the old browser and retries a failed ${via} replacement`,
			Effect.fnUntraced(function* () {
				const web = yield* servers()
				const before = cookie(yield* signIn(web.issuer, 'octocat'))
				const replace = yield* replacement(web.issuer, before, via)
				yield* Ref.set(web.failGrantWrite, Option.some((yield* Ref.get(web.grantWrites)) + 1))
				const failed = yield* replace()
				assert.isFalse(String.includes('__Host-session=')(cookie(failed)))
				assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: before}})).status, 200)
				yield* Ref.set(web.failGrantWrite, Option.none())
				const after = cookie(yield* replace())
				assert.deepStrictEqual(
					[
						(yield* send(web.issuer, '/me', {headers: {cookie: before}})).status,
						(yield* send(web.issuer, '/me', {headers: {cookie: after}})).status
					],
					[401, 200]
				)
			})
		)
	}

	test.effect(
		'returns a cancelled GitHub step to the sign-in it started from',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const start = yield* send(
				web.issuer,
				`/auth/github?${UrlParams.toString(UrlParams.fromInput({code: 'WDJB-MJHT'}))}`
			)
			const cancelled = yield* send(
				web.issuer,
				`/auth/github/callback?${UrlParams.toString(
					UrlParams.fromInput({
						error: 'access_denied',
						state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
					})
				)}`,
				{headers: {cookie: cookie(start)}}
			)
			assert.strictEqual(cancelled.headers.get('location'), '/?error=github&code=WDJB-MJHT')
		})
	)

	test.effect(
		'binds consent and one-use PKCE codes to the browser, client and callback while ignoring resource',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			assert.strictEqual((yield* send(web.issuer, '/me')).status, 401)
			// Registration is public, so a client names only a few short callbacks.
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/register', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
						redirect_uris: Array.replicate('http://127.0.0.1:34567/callback', 5)
					}),
					headers: {'content-type': 'application/json'},
					method: 'POST'
				})).status,
				400
			)
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: session}})).status, 200)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {cookie: cookie(yield* signIn(web.issuer, 'stranger'))}})).status,
				401
			)
			const request = yield* authorize(web.issuer, session, 'stash://auth/callback', [
				API,
				'https://scope.mp281x.xyz/mcp'
			])
			assert.strictEqual((yield* send(web.issuer, `/auth/request?request=${request.id}`)).status, 400)
			const callback = yield* consent(web.issuer, request, true)
			assert.strictEqual(callback.searchParams.get('iss'), `${AUTH_URL}/api/auth`)
			assert.strictEqual(callback.searchParams.get('state'), 'example-state')
			const code = callback.searchParams.get('code') ?? ''
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/token', {
					body: UrlParams.toString(
						UrlParams.fromInput({
							client_id: request.clientId,
							code,
							code_verifier: 'wrong',
							grant_type: 'authorization_code',
							redirect_uri: request.redirect
						})
					),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				400
			)
			const response = yield* exchange(web.issuer, request, code)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => response.text())
			)
			assert.strictEqual(token.expires_in, 600)
			// The scheme is case-insensitive and may be followed by several spaces.
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `bearer  ${token.access_token}`}})).status,
				200
			)
			// A second redemption of the code revokes what the first one got.
			assert.strictEqual((yield* exchange(web.issuer, request, code)).status, 400)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				401
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 400)
		})
	)

	test.effect(
		'answers 429 past an address’s budget per minute and accepts it again after the window',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const register = Effect.fnUntraced(function* (forwardedFor: string) {
				return yield* send(web.issuer, '/api/auth/oauth2/register', {
					body: '{"redirect_uris":["http://127.0.0.1:1/callback"]}',
					headers: {'content-type': 'application/json', 'x-forwarded-for': forwardedFor},
					method: 'POST'
				})
			})
			const statuses = yield* Effect.forEach(
				Array.range(1, 11),
				() => Effect.map(register('2001:db8:1:2::1'), response => response.status),
				{concurrency: 1}
			)
			assert.deepStrictEqual(Array.dedupe(Array.take(statuses, 10)), [201])
			// Another address in the same IPv6 /64 shares the budget; an address elsewhere does not.
			const limited = yield* register('2001:db8:1:2::ffff')
			assert.deepStrictEqual(
				[statuses[10], limited.status, String.isNonEmpty(limited.headers.get('retry-after') ?? '')],
				[429, 429, true]
			)
			assert.strictEqual((yield* register('2001:db8:9::1')).status, 201)
			yield* TestClock.adjust('61 seconds')
			assert.strictEqual((yield* register('2001:db8:1:2::1')).status, 201)
		})
	)

	test.effect(
		'redirects a request without redirect_uri to the client’s only callback',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const request = yield* authorize(
				web.issuer,
				cookie(yield* signIn(web.issuer, 'octocat')),
				'opm://auth/callback',
				[API]
			)
			assert.match(
				(yield* send(
					web.issuer,
					`/api/auth/oauth2/authorize?${UrlParams.toString(
						UrlParams.fromInput({
							client_id: request.clientId,
							code_challenge: 'x',
							code_challenge_method: 'S256',
							resource: API,
							response_type: 'code'
						})
					)}`
				)).headers.get('location') ?? '',
				/^\/\?request=/u
			)
			assert.strictEqual(
				(yield* exchange(
					web.issuer,
					request,
					(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
				)).status,
				200
			)
		})
	)

	test.effect(
		'redeems a code once under concurrent exchanges and revokes what it gave',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const request = yield* authorize(
				web.issuer,
				cookie(yield* signIn(web.issuer, 'octocat')),
				'opm://auth/callback',
				[API]
			)
			const code = (yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			const responses = yield* Effect.all([exchange(web.issuer, request, code), exchange(web.issuer, request, code)], {
				concurrency: 'unbounded'
			})
			assert.deepStrictEqual(
				Array.sort(
					Array.map(responses, response => response.status),
					Order.Number
				),
				[200, 400]
			)
			const winner = yield* Effect.fromOption(Array.findFirst(responses, response => response.status === 200))
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => winner.text())
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				401
			)
		})
	)

	test.effect(
		'accepts what OAuth 2.1 leaves optional and answers errors where the client listens',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const registered = yield* send(web.issuer, '/api/auth/oauth2/register', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Registration))({
					client_name: 'codex',
					redirect_uris: ['http://127.0.0.1:1455/callback', 'http://[::1]:1455/callback']
				}),
				headers: {'content-type': 'application/json'},
				method: 'POST'
			})
			const registration = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Struct({client_id: Schema.String, client_name: Schema.String}))
			)(yield* Effect.promise(() => registered.text()))
			assert.strictEqual(registration.client_name, 'codex')
			const challenge = Base64Url.encode(
				yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
			)
			const start = Effect.fnUntraced(function* (search: Record<string, string>) {
				return yield* send(
					web.issuer,
					`/api/auth/oauth2/authorize?${UrlParams.toString(
						UrlParams.fromInput({
							client_id: registration.client_id,
							code_challenge: challenge,
							code_challenge_method: 'S256',
							redirect_uri: 'http://127.0.0.1:1455/callback',
							resource: 'https://scope.mp281x.xyz/mcp',
							response_type: 'code',
							...search
						})
					)}`
				)
			})
			const location = Effect.fnUntraced(function* (search: Record<string, string>) {
				return (yield* start(search)).headers.get('location') ?? ''
			})
			// A loopback callback may come back on another port, IPv6 too, and a request with an empty or no state still signs in.
			assert.deepStrictEqual(
				Array.map(
					[
						yield* location({redirect_uri: 'http://[::1]:61000/callback', state: ''}),
						yield* location({redirect_uri: 'http://127.0.0.1:61000/callback'})
					],
					String.startsWith('/?request=')
				),
				[true, true]
			)
			// Anything else in the callback must match as written.
			assert.deepStrictEqual(
				[
					(yield* start({redirect_uri: 'http://127.1:50123/callback'})).status,
					(yield* start({redirect_uri: 'http://127.0.0.1:50123/other/../callback'})).status,
					(yield* start({redirect_uri: ''})).status
				],
				[400, 400, 400]
			)
			const moved = yield* start({redirect_uri: 'http://127.0.0.1:50123/callback'})
			assert.strictEqual(moved.status, 302)
			const callback = yield* consent(
				web.issuer,
				{
					clientId: registration.client_id,
					cookie: `${session}; ${cookie(moved)}`,
					id: new URL(moved.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? '',
					redirect: 'http://127.0.0.1:50123/callback'
				},
				true
			)
			assert.strictEqual(callback.port, '50123')
			assert.isFalse(callback.searchParams.has('state'))
			const token = Effect.fnUntraced(function* (params: Record<string, string>) {
				return yield* send(web.issuer, '/api/auth/oauth2/token', {
					body: UrlParams.toString(UrlParams.fromInput(params)),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})
			})
			const code = {
				client_id: registration.client_id,
				code: callback.searchParams.get('code') ?? '',
				code_verifier: VERIFIER,
				grant_type: 'authorization_code'
			}
			// A sent redirect_uri must match; left out, as OAuth 2.1 allows, the code still redeems.
			assert.strictEqual((yield* token({...code, redirect_uri: 'http://127.0.0.1:9/elsewhere'})).status, 400)
			const granted = yield* token({...code, redirect_uri: ''})
			assert.strictEqual(granted.status, 200)
			const refreshToken = (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => granted.text())
			)).refresh_token
			// A sent client_id must match; left out, a public client still refreshes.
			assert.deepStrictEqual(
				[
					(yield* token({client_id: 'another', grant_type: 'refresh_token', refresh_token: refreshToken})).status,
					(yield* token({grant_type: 'refresh_token', refresh_token: refreshToken})).status
				],
				[400, 200]
			)
			// Once the client and callback check out, a bad request returns to the callback with its state and issuer.
			const failed = new URL(yield* location({scope: 'admin', state: 'kept'}))
			assert.deepStrictEqual(
				[
					failed.origin,
					failed.searchParams.get('error'),
					failed.searchParams.get('state'),
					failed.searchParams.get('iss'),
					String.isNonEmpty(failed.searchParams.get('error_description') ?? '')
				],
				['http://127.0.0.1:1455', 'invalid_scope', 'kept', `${AUTH_URL}/api/auth`, true]
			)
			const returned = Effect.fnUntraced(function* (search: Record<string, string>) {
				return new URL(yield* location(search)).searchParams.get('error')
			})
			assert.deepStrictEqual(
				[yield* returned({response_type: 'token'}), yield* returned({response_type: ''})],
				['unsupported_response_type', 'invalid_request']
			)
			// An unknown client, a foreign callback or a left-out one among several never gets a redirect.
			assert.deepStrictEqual(
				[
					(yield* start({redirect_uri: 'http://evil.test/callback'})).status,
					(yield* send(
						web.issuer,
						`/api/auth/oauth2/authorize?${UrlParams.toString(
							UrlParams.fromInput({client_id: registration.client_id, response_type: 'code'})
						)}`
					)).status
				],
				[400, 400]
			)
			const unknown = yield* send(web.issuer, '/api/auth/oauth2/authorize?client_id=unknown')
			assert.strictEqual(unknown.status, 400)
			const errors = yield* Effect.forEach(
				[
					send(web.issuer, '/api/auth/oauth2/token', {
						body: 'grant_type=password',
						headers: {'content-type': 'application/x-www-form-urlencoded'},
						method: 'POST'
					}),
					send(web.issuer, '/api/auth/oauth2/register', {
						body: '{"redirect_uris":["https://evil.test/callback"]}',
						headers: {'content-type': 'application/json'},
						method: 'POST'
					}),
					send(web.issuer, '/api/auth/oauth2/register', {
						body: '{"redirect_uris":[]}',
						headers: {'content-type': 'application/json'},
						method: 'POST'
					}),
					Effect.succeed(unknown)
				],
				Effect.fnUntraced(function* (pending) {
					const response = yield* pending
					return (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({error: Schema.String})))(
						yield* Effect.promise(() => response.text())
					)).error
				}),
				{concurrency: 1}
			)
			assert.deepStrictEqual(errors, [
				'unsupported_grant_type',
				'invalid_redirect_uri',
				'invalid_client_metadata',
				'invalid_client'
			])
		})
	)

	test.effect(
		'rotates refresh tokens, revokes a reused or revoked family, and ends the session at sign-out',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, session, 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const first = yield* exchange(
				web.issuer,
				request,
				(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => first.text())
			)
			assert.strictEqual(token.expires_in, 600)
			assert.strictEqual(first.headers.get('cache-control'), 'no-store')
			assert.strictEqual(first.headers.get('pragma'), 'no-cache')
			const second = yield* refresh(web.issuer, request.clientId, token.refresh_token)
			const rotated = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => second.text())
			)
			assert.notStrictEqual(rotated.refresh_token, token.refresh_token)
			const third = yield* refresh(web.issuer, request.clientId, rotated.refresh_token)
			const latest = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => third.text())
			)
			// The family is the public prefix of every bearer, so it alone revokes nothing and proves no replay.
			const family = String.split(token.refresh_token, '.')[0]
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/revoke', {
					body: UrlParams.toString(
						UrlParams.fromInput({client_id: request.clientId, token: `${family}.${String.repeat(43)('A')}`})
					),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				200
			)
			assert.strictEqual(
				(yield* refresh(web.issuer, request.clientId, `${family}.0.${String.repeat(43)('A')}`)).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${rotated.access_token}`}})).status,
				200
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 400)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, rotated.refresh_token)).status, 400)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, latest.refresh_token)).status, 400)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${rotated.access_token}`}})).status,
				401
			)
			yield* authorize(web.issuer, session, 'opm://auth/callback', [API])
			const next = yield* authorize(web.issuer, session, 'stash-dev://auth/callback', [API])
			const nextResponse = yield* exchange(
				web.issuer,
				next,
				(yield* consent(web.issuer, next, true)).searchParams.get('code') ?? ''
			)
			const active = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => nextResponse.text())
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/revoke', {
					body: UrlParams.toString(UrlParams.fromInput({client_id: next.clientId, token: active.refresh_token})),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				200
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${active.access_token}`}})).status,
				401
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/sign-out', {headers: {cookie: session, origin: AUTH_URL}, method: 'POST'}))
					.status,
				204
			)
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: session}})).status, 401)
		})
	)

	test.effect(
		'denies access without issuing a code and expires a code before exchange',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const denied = yield* consent(
				web.issuer,
				yield* authorize(web.issuer, session, 'http://localhost:34567/callback', ['https://scope.mp281x.xyz/mcp']),
				false
			)
			assert.strictEqual(denied.searchParams.get('error'), 'access_denied')
			assert.isFalse(denied.searchParams.has('code'))
			const request = yield* authorize(web.issuer, session, 'stash://auth/callback', [API])
			const callback = yield* consent(web.issuer, request, true)
			yield* TestClock.adjust('61 seconds')
			assert.strictEqual((yield* exchange(web.issuer, request, callback.searchParams.get('code') ?? '')).status, 400)
		})
	)

	test.effect(
		'lets an agent answer a waiting sign-in by its code as the browser does',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const token = yield* agentToken(web.issuer, cookie(yield* signIn(web.issuer, 'octocat')))
			const simulator = yield* authorize(web.issuer, '', 'opm-dev://auth/callback', [
				'https://opm.mp281x.xyz',
				'https://scope.mp281x.xyz/mcp'
			])
			const desktop = yield* authorize(web.issuer, '', 'http://127.0.0.1:34570/callback', [
				'https://scope.mp281x.xyz/mcp',
				APPROVALS
			])
			const release = yield* authorize(web.issuer, '', 'stash://auth/callback', [API, 'https://scope.mp281x.xyz/mcp'])
			assert.strictEqual(
				(yield* callTool(web.issuer, '', 'answer_request', {accept: true, request: simulator.id})).status,
				401
			)
			yield* Effect.forEach(
				[
					{accept: true, request: `${String.slice(0, 4)(simulator.id)}-${String.slice(4)(simulator.id)}`},
					{accept: true, request: desktop.id},
					{accept: false, request: String.toLowerCase(release.id)}
				],
				input => callTool(web.issuer, token, 'answer_request', input),
				{concurrency: 1, discard: true}
			)
			const callbacks = yield* Effect.forEach(
				[simulator, desktop, release],
				Effect.fnUntraced(function* (request) {
					const params = (yield* delivered(web.issuer, request)).searchParams
					return {code: params.get('code') ?? '', error: params.get('error') ?? ''}
				}),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map(callbacks, callback => [String.isNonEmpty(callback.code), callback.error]),
				[
					[true, ''],
					[true, ''],
					[false, 'access_denied']
				]
			)
			const signedIn = yield* exchange(web.issuer, simulator, callbacks[0]?.code ?? '')
			const access = (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => signedIn.text())
			)).access_token
			const verified = yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${access}`}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(User))(yield* Effect.promise(() => verified.text())),
				{id: 'github:42', name: 'octocat'}
			)
		})
	)

	test.effect(
		'lets only an admin allow, decline and remove GitHub accounts, which sign them in and out',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			const drifter = cookie(yield* signIn(web.issuer, 'drifter'))
			const status = Effect.fnUntraced(function* (session: string) {
				return (yield* send(web.issuer, '/me', {headers: {cookie: session}})).status
			})
			const text = Effect.fnUntraced(function* (response: Response) {
				return yield* Effect.promise(() => response.text())
			})
			assert.deepStrictEqual([yield* status(stranger), yield* status(drifter)], [401, 401])
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['drifter:Waiting', 'stranger:Waiting', 'octocat:Admin'])
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			yield* post(web.issuer, '/admit', admin, {allow: false, id: 'github:9'})
			assert.deepStrictEqual([yield* status(stranger), yield* status(drifter)], [200, 401])
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin', 'stranger:Member'])
			const member = yield* agentToken(web.issuer, stranger)
			assert.isTrue(
				String.includes('Only an admin can manage people')(
					yield* text(yield* post(web.issuer, '/remove-person', stranger, {id: 'github:42'}))
				)
			)
			assert.isTrue(
				String.includes('cannot be removed here')(
					yield* text(yield* post(web.issuer, '/remove-person', admin, {id: 'github:42'}))
				)
			)
			yield* post(web.issuer, '/remove-person', admin, {id: 'github:7'})
			assert.strictEqual(yield* status(stranger), 401)
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${member}`}})).status, 401)
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin'])
		})
	)

	test.effect(
		'lists each app an account signed in to by its last refresh and disconnects only its own',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, admin, 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const exchanged = yield* exchange(
				web.issuer,
				request,
				(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			)
			const granted = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => exchanged.text())
			)
			const apps = Effect.fnUntraced(function* (session: string) {
				const response = yield* send(web.issuer, '/apps', {headers: {cookie: session}})
				return Array.filter(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => response.text())
					),
					app => app.kind === 'App'
				)
			})
			const signedIn = yield* apps(admin)
			assert.deepStrictEqual(
				Array.map(signedIn, app => [app.client, app.device]),
				[['Opencode', '93.184.216.34']]
			)
			yield* TestClock.adjust('1 hour')
			const rotated = yield* refresh(web.issuer, request.clientId, granted.refresh_token)
			const next = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => rotated.text())
			)
			const refreshed = yield* apps(admin)
			assert.strictEqual(refreshed[0]?.lastActive, (signedIn[0]?.lastActive ?? 0) + 3_600_000)
			const family = refreshed[0]?.family ?? ''
			// Another account sees none of these and cannot disconnect them.
			const agent = yield* agentToken(web.issuer, admin)
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			assert.deepStrictEqual(yield* apps(stranger), [])
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${family}`, {headers: {cookie: stranger}, method: 'POST'})).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${family}`, {headers: {cookie: admin}, method: 'POST'})).status,
				204
			)
			// The agent's own sign-in stays; the disconnected app has to sign in again.
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {authorization: `Bearer ${agent}`}})).status, 200)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, next.refresh_token)).status, 400)
		})
	)

	test.effect(
		'replaces a sign-in of the same client from the same address, and keeps one from elsewhere',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const signInFrom = Effect.fnUntraced(function* (forwardedFor: string) {
				const request = yield* authorize(web.issuer, admin, 'http://127.0.0.1:34567/callback', [
					'https://scope.mp281x.xyz/mcp'
				])
				const exchanged = yield* exchange(
					web.issuer,
					request,
					(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? '',
					forwardedFor
				)
				return {
					clientId: request.clientId,
					tokens: yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => exchanged.text())
					)
				}
			})
			const apps = Effect.flatMap(send(web.issuer, '/apps', {headers: {cookie: admin}}), response =>
				Effect.map(
					Effect.flatMap(
						Effect.promise(() => response.text()),
						Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))
					),
					Array.filter(app => app.kind === 'App')
				)
			)
			// Traefik appends the connecting address last; the entry before it is whatever the client sent.
			const first = yield* signInFrom('1.1.1.1, 93.184.216.34')
			yield* signInFrom('93.184.216.34')
			assert.strictEqual((yield* apps).length, 1)
			assert.strictEqual((yield* refresh(web.issuer, first.clientId, first.tokens.refresh_token)).status, 400)
			yield* signInFrom('1.1.1.1')
			assert.deepStrictEqual(
				Array.sort(
					Array.map(yield* apps, app => app.device),
					String.Order
				),
				['1.1.1.1', '93.184.216.34']
			)
			// A worker's private address reads as the worker.
			yield* signInFrom('100.68.201.107')
			assert.isTrue(Array.some(yield* apps, app => app.device === 'dev'))
		})
	)

	test.effect(
		'signs a browser in with a code another device approves and returns it to its page on this domain',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, admin)
			const start = Effect.fnUntraced(function* (next: string) {
				const started = yield* send(web.issuer, `/auth/code?${UrlParams.toString(UrlParams.fromInput({next}))}`, {
					headers: {'user-agent': IPHONE_SAFARI}
				})
				return {
					cookie: cookie(started),
					id: new URL(started.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? ''
				}
			})
			const browser = yield* start('https://stash.mp281x.xyz/notes')
			const waiting = yield* send(web.issuer, `/auth/request?request=${browser.id}`, {
				headers: {cookie: browser.cookie}
			})
			const status = yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
				yield* Effect.promise(() => waiting.text())
			)
			if (status._tag !== 'Waiting') return yield* Effect.die('Expected a waiting browser sign-in')
			assert.deepStrictEqual(
				[status.request.kind, status.request.clientName, status.request.device],
				['Browser', 'Safari', 'iPhone']
			)
			// A session in a browser grants every app, so an agent's token cannot approve one.
			const byAgent = yield* callTool(web.issuer, token, 'answer_request', {accept: true, request: browser.id})
			assert.isTrue(String.includes('only from a signed-in browser')(yield* Effect.promise(() => byAgent.text())))
			assert.strictEqual((yield* answer(web.issuer, admin, browser.id, true)).status, 204)
			const signedIn = yield* send(web.issuer, `/auth/continue?request=${browser.id}`, {
				headers: {cookie: browser.cookie}
			})
			assert.strictEqual(signedIn.headers.get('location'), 'https://stash.mp281x.xyz/notes')
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: cookie(signedIn)}})).status, 200)
			// A code may have been approved for another person's browser, so its session lasts 30 days, not a year.
			assert.isTrue(
				Array.some(
					signedIn.headers.getSetCookie(),
					value => String.startsWith('__Host-session=')(value) && String.includes('Max-Age=2592000')(value)
				)
			)
			// The approved browser is listed among the account's sign-ins, and signing it out there ends its session.
			const listed = yield* send(web.issuer, '/apps', {headers: {cookie: admin}})
			const browserApp = yield* Effect.fromOption(
				Array.findFirst(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => listed.text())
					),
					app => app.client === 'Safari' && app.device === 'iPhone'
				)
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${browserApp.family}`, {headers: {cookie: admin}, method: 'POST'}))
					.status,
				204
			)
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: cookie(signedIn)}})).status, 401)
			// An approver removed before delivery delivers a denial.
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const late = yield* start('https://stash.mp281x.xyz/notes')
			assert.strictEqual((yield* answer(web.issuer, stranger, late.id, true)).status, 204)
			yield* post(web.issuer, '/remove-person', admin, {id: 'github:7'})
			const declined = yield* send(web.issuer, `/auth/continue?request=${late.id}`, {headers: {cookie: late.cookie}})
			assert.strictEqual(declined.headers.get('location'), '/')
			assert.isFalse(String.includes('__Host-session=')(cookie(declined)))
			// A page elsewhere is dropped, and a denied browser gets no session.
			const elsewhere = yield* start('https://evil.test/')
			assert.strictEqual((yield* answer(web.issuer, admin, elsewhere.id, false)).status, 204)
			const denied = yield* send(web.issuer, `/auth/continue?request=${elsewhere.id}`, {
				headers: {cookie: elsewhere.cookie}
			})
			assert.strictEqual(denied.headers.get('location'), '/')
			assert.isFalse(String.includes('__Host-session=')(cookie(denied)))
		})
	)

	test.effect(
		'signs a command in with a device code its agent approves, answering pending until then and the tokens once',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const token = yield* agentToken(web.issuer, cookie(yield* signIn(web.issuer, 'octocat')))
			const client = clientIdOf({name: 'coding-standards', redirects: ['http://127.0.0.1/callback']})
			const started = yield* send(
				web.issuer,
				'/api/auth/oauth2/device_authorization',
				formPost({client_id: client, resource: 'https://gateway.mp281x.xyz'})
			)
			const device = yield* Schema.decodeEffect(
				Schema.fromJsonString(
					Schema.Struct({
						device_code: Schema.String,
						user_code: Schema.String,
						verification_uri_complete: Schema.String
					})
				)
			)(yield* Effect.promise(() => started.text()))
			assert.strictEqual(device.verification_uri_complete, `${AUTH_URL}/?code=${device.user_code}`)
			const poll = Effect.fnUntraced(function* (clientId: string) {
				const response = yield* send(
					web.issuer,
					'/api/auth/oauth2/token',
					formPost({client_id: clientId, device_code: device.device_code, grant_type: DEVICE_GRANT})
				)
				return {status: response.status, text: yield* Effect.promise(() => response.text())}
			})
			assert.isTrue(String.includes('"authorization_pending"')((yield* poll(client)).text))
			const other = clientIdOf({name: 'other', redirects: ['http://127.0.0.1/callback']})
			assert.isTrue(String.includes('"invalid_grant"')((yield* poll(other)).text))
			assert.strictEqual(
				(yield* callTool(web.issuer, token, 'answer_request', {accept: true, request: device.user_code})).status,
				200
			)
			const granted = yield* poll(client)
			assert.strictEqual(granted.status, 200)
			const tokens = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(granted.text)
			assert.strictEqual(
				(yield* Schema.decodeUnknownEffect(AccessClaims)((yield* Jwt.decodeUnverified(tokens.access_token)).claims))
					.azp,
				'Coding-standards'
			)
			assert.isTrue(String.includes('"expired_token"')((yield* poll(client)).text))
		})
	)

	test.effect(
		'lists and signs out sessions through the MCP tools',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const first = cookie(yield* signIn(web.issuer, 'octocat'))
			const second = cookie(yield* signIn(web.issuer, 'octocat'))
			const agent = yield* agentToken(web.issuer, first)
			assert.strictEqual((yield* callTool(web.issuer, '', 'list_sessions', {})).status, 401)
			const listed = yield* Schema.decodeUnknownEffect(
				Schema.Struct({
					sessions: Schema.Array(
						Schema.Struct({
							address: Schema.optionalKey(Schema.String),
							client: Schema.String,
							device: Schema.optionalKey(Schema.String),
							id: Schema.NonEmptyString,
							lastActive: Schema.DateTimeUtcFromString
						})
					)
				})
			)(yield* toolResult(yield* callTool(web.issuer, agent, 'list_sessions', {})))
			assert.deepStrictEqual(
				Array.sort(
					Array.map(listed.sessions, session => session.client),
					String.Order
				),
				['Browser', 'Browser', 'Opencode']
			)
			assert.isTrue(
				Array.every(listed.sessions, session => session.device === undefined || session.device !== session.address)
			)
			const command = yield* Effect.fromOption(
				Array.findFirst(listed.sessions, session => session.client === 'Opencode')
			)
			assert.deepStrictEqual([command.address, command.device], ['93.184.216.34', undefined])
			const browser = yield* Effect.fromOption(
				Array.findFirst(listed.sessions, session => session.client === 'Browser')
			)
			assert.strictEqual((yield* callTool(web.issuer, agent, 'sign_out_session', {id: browser.id})).status, 200)
			assert.deepStrictEqual(
				Array.sort(
					Array.map(
						[
							yield* send(web.issuer, '/me', {headers: {cookie: first}}),
							yield* send(web.issuer, '/me', {headers: {cookie: second}})
						],
						response => response.status
					),
					Order.Number
				),
				[200, 401]
			)
			const unknown = yield* callTool(web.issuer, agent, 'sign_out_session', {id: 'aaaaaaaaaaaaaaaa'})
			assert.include(yield* Effect.promise(() => unknown.text()), 'This sign-in has already ended')
		})
	)

	test.effect(
		"lists and removes a passkey through the MCP tools, only its owner's",
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const member = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const key = yield* authenticator()
			const options = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: admin}}), response =>
					Effect.promise(() => response.text())
				)
			)
			const added = yield* key.register(options)
			assert.strictEqual((yield* post(web.issuer, '/add-passkey', admin, {response: added})).status, 204)
			const memberKey = yield* authenticator()
			const memberOptions = yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
				yield* Effect.flatMap(send(web.issuer, '/passkey-options', {headers: {cookie: member}}), response =>
					Effect.promise(() => response.text())
				)
			)
			const memberAdded = yield* memberKey.register(memberOptions)
			assert.strictEqual((yield* post(web.issuer, '/add-passkey', member, {response: memberAdded})).status, 204)
			const agent = yield* agentToken(web.issuer, admin)
			assert.strictEqual((yield* callTool(web.issuer, '', 'list_passkeys', {})).status, 401)
			const listed = yield* Schema.decodeUnknownEffect(Schema.Struct({passkeys: Schema.Array(Passkey)}))(
				yield* toolResult(yield* callTool(web.issuer, agent, 'list_passkeys', {}))
			)
			assert.deepStrictEqual(listed.passkeys, [{addedFrom: 'Safari · iPhone', id: added.id, synced: false}])
			const denied = yield* callTool(web.issuer, agent, 'remove_passkey', {id: memberAdded.id})
			assert.include(yield* Effect.promise(() => denied.text()), 'No passkey of yours has that id')
			const memberAgent = yield* agentToken(web.issuer, member)
			const remaining = yield* Schema.decodeUnknownEffect(Schema.Struct({passkeys: Schema.Array(Passkey)}))(
				yield* toolResult(yield* callTool(web.issuer, memberAgent, 'list_passkeys', {}))
			)
			assert.deepStrictEqual(remaining.passkeys, [{addedFrom: 'Safari · iPhone', id: memberAdded.id, synced: false}])
			assert.deepStrictEqual(yield* toolResult(yield* callTool(web.issuer, agent, 'remove_passkey', {id: added.id})), {
				id: added.id
			})
			const emptied = yield* Schema.decodeUnknownEffect(Schema.Struct({passkeys: Schema.Array(Passkey)}))(
				yield* toolResult(yield* callTool(web.issuer, agent, 'list_passkeys', {}))
			)
			assert.deepStrictEqual(emptied.passkeys, [])
		})
	)

	test.effect(
		'removes a member through the MCP tool as an admin only',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const agent = yield* agentToken(web.issuer, admin)
			const memberAgent = yield* agentToken(web.issuer, stranger)
			const denied = yield* callTool(web.issuer, memberAgent, 'remove_person', {login: 'octocat'})
			assert.include(yield* Effect.promise(() => denied.text()), 'Only an admin can manage people')
			const hidden = yield* callTool(web.issuer, memberAgent, 'list_people', {})
			assert.include(yield* Effect.promise(() => hidden.text()), 'Only an admin can manage people')
			assert.deepStrictEqual(yield* toolResult(yield* callTool(web.issuer, agent, 'list_people', {})), {
				people: [
					{login: 'octocat', role: 'Admin'},
					{login: 'stranger', role: 'Member'}
				]
			})
			assert.strictEqual((yield* callTool(web.issuer, agent, 'remove_person', {login: 'stranger'})).status, 200)
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin'])
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: stranger}})).status, 401)
			const unknown = yield* callTool(web.issuer, agent, 'remove_person', {login: 'nobody'})
			assert.include(yield* Effect.promise(() => unknown.text()), 'is listed in Auth')
			const adminRow = yield* callTool(web.issuer, agent, 'remove_person', {login: 'octocat'})
			assert.include(yield* Effect.promise(() => adminRow.text()), 'cannot be removed here')
		})
	)
})
