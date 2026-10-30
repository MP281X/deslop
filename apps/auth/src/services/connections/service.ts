import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Match,
	Number,
	Option,
	Path,
	Record,
	Ref,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {
	Client,
	StreamableHTTPClientTransport,
	discoverOAuthServerInfo,
	extractWWWAuthenticateParams
} from '@modelcontextprotocol/client'
import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import type {User} from '@deslop/runtime/auth/schema'
import {AuthError, Resource} from '@deslop/runtime/auth/schema'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import {layerKeyValueStore} from '@deslop/runtime/server'

import {Changes} from '#services/changes/service.ts'
import {connectionInfo, describe, serverName} from '#services/connections/lib/utils.ts'
import type {Callback, Connection, ConnectionInfo, Discovery, ServerId} from '#services/connections/schema.ts'
import {ConnectionState, Metadata, Registration, ServerUrl, Token} from '#services/connections/schema.ts'
import {People} from '#services/people/service.ts'

const CALLBACK = `${AUTH_URL}/auth/mcp/callback`
const CLIENT_METADATA = `${AUTH_URL}/auth/mcp/client.json`

// Auth's client metadata document, for providers that accept one instead of a registration.
export const CLIENT = {
	client_id: CLIENT_METADATA,
	client_name: 'Deslop MCP gateway',
	grant_types: ['authorization_code', 'refresh_token'],
	redirect_uris: [CALLBACK],
	response_types: ['code'],
	token_endpoint_auth_method: 'none'
}

function failed(message: string) {
	return Effect.mapError((cause: unknown) => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message: `${message}: ${describe(cause)}`})
	})
}

function validMetadata(metadata: Metadata) {
	return Array.every(
		[
			metadata.issuer,
			metadata.authorization_endpoint,
			metadata.token_endpoint,
			...Option.toArray(Option.fromUndefinedOr(metadata.registration_endpoint))
		],
		endpoint => Schema.is(ServerUrl)(endpoint)
	)
}

export class Connections extends Context.Service<
	Connections,
	{
		readonly add: (url: string, user: User) => Effect.Effect<ConnectionInfo, AuthError>
		readonly begin: (id: ServerId, user: User) => Effect.Effect<{state: Option.Option<string>; url: string}, AuthError>
		readonly complete: (params: Callback, user: User) => Effect.Effect<void, AuthError>
		readonly definitions: Effect.Effect<Connection[]>
		readonly disconnect: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly get: (id: ServerId) => Effect.Effect<Connection, AuthError>
		readonly list: Effect.Effect<ConnectionInfo[]>
		readonly remove: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly report: (id: ServerId, generation: string, outcome: Discovery) => Effect.Effect<void>
		readonly token: (id: ServerId, generation: string, rejectedToken?: string) => Effect.Effect<string, AuthError>
		readonly watch: (user: User) => Stream.Stream<ConnectionInfo[], AuthError>
	}
>()('@deslop/auth/services/connections/service/Connections') {
	static readonly make = Effect.gen(function* () {
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, ConnectionState)
		const state = yield* Ref.make<ConnectionState>(
			Option.getOrElse(yield* store.get('connections'), () => ({connections: {}, pending: {}}))
		)
		const changes = yield* Changes
		const writes = yield* Semaphore.make(1)
		const people = yield* People
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const fetch = yield* FetchHttpClient.Fetch
		const random = yield* SecureRandom.SecureRandom
		const digest = yield* Digest.Digest
		const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)
		function save(next: ConnectionState) {
			return pipe(
				store.set('connections', next),
				Effect.andThen(Ref.set(state, next)),
				Effect.andThen(changes.publish),
				Effect.uninterruptible
			)
		}
		const get = Effect.fnUntraced(function* (id: ServerId) {
			return yield* pipe(
				Record.get((yield* Ref.get(state)).connections, id),
				Effect.fromOption,
				Effect.mapError(() => AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'}))
			)
		})
		const list = Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			return Array.map(Record.values((yield* Ref.get(state)).connections), row => connectionInfo(row, now))
		})
		const put = Effect.fnUntraced(function* (connection: Connection) {
			const current = yield* Ref.get(state)
			yield* save({...current, connections: {...current.connections, [connection.id]: connection}})
		})
		const registration = Effect.fnUntraced(function* (connection: Connection) {
			if (connection.clientId !== undefined) return connection
			if (connection.metadata === undefined || !validMetadata(connection.metadata)) {
				return yield* AuthError.make({message: 'The MCP has no supported OAuth discovery metadata.'})
			}
			const clientId = yield* Boolean.match(connection.metadata.client_id_metadata_document_supported === true, {
				onFalse: () =>
					pipe(
						Effect.fromOption(Option.fromUndefinedOr(connection.metadata?.registration_endpoint)),
						Effect.mapError(() =>
							AuthError.make({
								message: 'This MCP requires a pre-registered OAuth client; automatic registration is not supported.'
							})
						),
						Effect.flatMap(endpoint => HttpClientRequest.bodyJson(HttpClientRequest.post(endpoint), CLIENT)),
						Effect.flatMap(request => client.execute(request)),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Registration)),
						Effect.map(found => found.client_id)
					),
				onTrue: () => Effect.succeed(CLIENT_METADATA)
			})
			const next = {...connection, clientId}
			yield* put(next)
			return next
		})
		const exchange = Effect.fnUntraced(function* (connection: Connection, params: Record<string, string>) {
			if (
				connection.metadata === undefined ||
				connection.clientId === undefined ||
				!validMetadata(connection.metadata)
			) {
				return yield* AuthError.make({message: 'Invalid stored authorization server'})
			}
			const token = yield* pipe(
				HttpClientRequest.post(connection.metadata.token_endpoint),
				HttpClientRequest.bodyUrlParams({...params, client_id: connection.clientId, resource: connection.url}),
				request => client.execute(request),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
				Effect.catchTag(
					'HttpClientError',
					Effect.fnUntraced(function* (cause) {
						if (
							params['grant_type'] === 'refresh_token' &&
							connection.token !== undefined &&
							cause.reason._tag === 'StatusCodeError' &&
							(cause.reason.response.status === 400 || cause.reason.response.status === 401)
						) {
							yield* put({...connection, expiresAt: 0, token: Struct.omit(connection.token, ['refresh_token'])})
						}
						return yield* cause
					})
				),
				Effect.timeout('20 seconds')
			)
			const next = {
				...Struct.omit(connection, ['error']),
				enabled: true,
				expiresAt: (yield* Clock.currentTimeMillis) + (token.expires_in ?? 3600) * 1000,
				token: Boolean.match(params['grant_type'] === 'refresh_token', {
					onFalse: () => token,
					onTrue: () => ({...token, refresh_token: token.refresh_token ?? connection.token?.refresh_token})
				})
			}
			yield* put(next)
			return next.token.access_token
		}, Effect.uninterruptible)
		const token = Effect.fn('Connections.token')(
			function* (id: ServerId, generation: string, rejectedToken?: string) {
				return yield* writes.withPermit(
					Effect.gen(function* () {
						const connection = yield* get(id)
						if (connection.generation !== generation) {
							return yield* AuthError.make({message: 'This MCP connection was replaced.'})
						}
						if (!connection.enabled || connection.token === undefined) {
							return yield* AuthError.make({message: `Connect ${connection.name} on ${AUTH_URL}/mcp-servers`})
						}
						if (
							connection.token.access_token !== rejectedToken &&
							connection.expiresAt >
								(yield* Clock.currentTimeMillis) +
									Boolean.match(connection.token.refresh_token === undefined, {onFalse: () => 30_000, onTrue: () => 0})
						) {
							return connection.token.access_token
						}
						if (connection.token.refresh_token === undefined) {
							return yield* AuthError.make({message: `Reconnect ${connection.name}; its authorization expired`})
						}
						return yield* exchange(connection, {
							grant_type: 'refresh_token',
							refresh_token: connection.token.refresh_token
						})
					})
				)
			},
			Effect.timeout('20 seconds'),
			failed('Cannot refresh this MCP; reconnect it from the MCP page')
		)
		const discover = Effect.fnUntraced(function* (initial: Connection) {
			if (Schema.is(Resource)(initial.url) && String.endsWith('/mcp')(initial.url)) return initial
			const probe = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				id: 1,
				jsonrpc: '2.0',
				method: 'tools/list',
				params: {}
			})
			const response = yield* Effect.tryPromise(signal =>
				fetch(initial.url, {
					body: probe,
					headers: {
						accept: 'application/json, text/event-stream',
						'content-type': 'application/json',
						'mcp-protocol-version': '2025-06-18'
					},
					method: 'POST',
					signal
				})
			)
			const challenge = extractWWWAuthenticateParams(response)
			yield* Option.match(Option.fromNullishOr(response.body), {
				onNone: () => Effect.void,
				onSome: Effect.fnUntraced(function* (body) {
					yield* Effect.tryPromise(() => body.cancel())
				})
			})
			const discovery = yield* Effect.tryPromise(signal =>
				discoverOAuthServerInfo(initial.url, {
					fetchFn: (target, init) =>
						fetch(target, {
							...init,
							signal: AbortSignal.any([signal, ...Option.toArray(Option.fromNullishOr(init?.signal))])
						}),
					resourceMetadataUrl: challenge.resourceMetadataUrl
				})
			)
			if (discovery.resourceMetadata !== undefined && discovery.resourceMetadata.resource !== initial.url) {
				return yield* AuthError.make({message: 'The MCP metadata names a different resource URL.'})
			}
			if (discovery.authorizationServerMetadata === undefined) {
				const transport = new StreamableHTTPClientTransport(new URL(initial.url), {
					fetch,
					requestInit: {redirect: 'error'}
				})
				const anonymous = yield* Effect.acquireRelease(
					Effect.sync(
						() => new Client({name: 'Deslop MCP gateway', version: '0.1.0'}, {versionNegotiation: {mode: 'auto'}})
					),
					acquired =>
						pipe(
							Effect.tryPromise(() => transport.terminateSession()),
							Effect.timeout('3 seconds'),
							Effect.ignore({log: 'Warn', message: 'Cannot terminate the anonymous MCP session'}),
							Effect.andThen(Effect.promise(() => acquired.close()))
						)
				)
				yield* Effect.tryPromise(signal => anonymous.connect(transport, {signal}))
				const tools = yield* Effect.tryPromise(signal => anonymous.listTools(undefined, {signal}))
				return {
					...initial,
					mode: 'public',
					name: anonymous.getServerVersion()?.name ?? initial.name,
					tools: tools.tools.length
				} satisfies Connection
			}
			const metadata = yield* Schema.decodeEffect(Metadata)(discovery.authorizationServerMetadata)
			if (!validMetadata(metadata)) {
				return yield* AuthError.make({message: 'The MCP returned unsafe authorization endpoints.'})
			}
			return {
				...initial,
				enabled: false,
				metadata,
				mode: 'oauth',
				name: discovery.resourceMetadata?.resource_name ?? initial.name,
				scope: challenge.scope ?? Array.join(discovery.resourceMetadata?.scopes_supported ?? [], ' ')
			} satisfies Connection
		})
		const add = Effect.fn('Connections.add')(
			function* (input: string, user: User) {
				yield* people.admin(user)
				yield* Schema.decodeEffect(ServerUrl)(input)
				const url = new URL(input).href
				return yield* writes.withPermit(
					Effect.gen(function* () {
						const current = yield* Ref.get(state)
						if (Array.some(Record.values(current.connections), row => row.url === url)) {
							return yield* AuthError.make({message: 'This MCP has already been added.'})
						}
						const base = serverName(url) || 'mcp'
						const id = yield* Boolean.match(current.connections[base] === undefined, {
							onFalse: () => Effect.map(nonce, suffix => `${base}_${String.slice(0, 6)(String.toLowerCase(suffix))}`),
							onTrue: () => Effect.succeed(base)
						})
						const initial: Connection = {
							enabled: true,
							expiresAt: 0,
							generation: yield* nonce,
							id,
							mode: 'deslop',
							name: String.capitalize(base),
							scope: '',
							url
						}
						const connection = yield* discover(initial)
						yield* put(connection)
						return connectionInfo(connection, yield* Clock.currentTimeMillis)
					})
				)
			},
			Effect.scoped,
			Effect.timeout('20 seconds'),
			failed('Cannot add this MCP. Check its public HTTPS URL and OAuth discovery support.')
		)
		// Records why a step failed on its row, so the MCP page shows it; the failure still reaches the caller.
		const fail = Effect.fnUntraced(function* (id: ServerId, cause: unknown) {
			const message = describe(cause)
			yield* pipe(
				Effect.gen(function* () {
					const current = (yield* Ref.get(state)).connections[id]
					if (current !== undefined && current.error !== message) yield* put({...current, error: message})
				}),
				writes.withPermit,
				Effect.ignore({log: 'Warn', message: 'Cannot save the MCP failure'})
			)
			return yield* AuthError.make({cause, message})
		})
		const begin = Effect.fn('Connections.begin')(function* (id: ServerId, user: User) {
			yield* people.admin(user)
			return yield* pipe(
				writes.withPermit(
					Effect.gen(function* () {
						const initial = yield* get(id)
						if (initial.mode !== 'oauth') {
							yield* put({...Struct.omit(initial, ['error']), enabled: true})
							return {state: Option.none<string>(), url: '/mcp-servers'}
						}
						const connection = yield* registration(initial)
						if (connection.metadata === undefined || connection.clientId === undefined) {
							return yield* AuthError.make({message: 'Missing OAuth registration'})
						}
						const stateId = yield* nonce
						const verifier = yield* nonce
						const now = yield* Clock.currentTimeMillis
						const current = yield* Ref.get(state)
						yield* save({
							...current,
							pending: {
								...Record.filter(current.pending, entry => entry.expiresAt > now && entry.id !== id),
								[stateId]: {expiresAt: now + 600_000, id, userId: user.id, verifier}
							}
						})
						const url = new URL(connection.metadata.authorization_endpoint)
						url.search = new URLSearchParams({
							client_id: connection.clientId,
							code_challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier))),
							code_challenge_method: 'S256',
							redirect_uri: CALLBACK,
							resource: connection.url,
							response_type: 'code',
							scope: connection.scope,
							state: stateId
						}).toString()
						return {state: Option.some(stateId), url: url.href}
					})
				),
				Effect.timeout('30 seconds'),
				Effect.catch(cause => fail(id, cause))
			)
		})
		const complete = Effect.fn('Connections.complete')(function* (params: Callback, user: User) {
			yield* people.admin(user)
			// The flow is taken once, whatever the provider answered.
			const pending = yield* pipe(
				Effect.gen(function* () {
					const current = yield* Ref.get(state)
					const found = current.pending[params.state]
					if (found === undefined || found.userId !== user.id || found.expiresAt <= (yield* Clock.currentTimeMillis)) {
						return yield* AuthError.make({message: 'The connection expired; connect it again'})
					}
					yield* save({...current, pending: Record.remove(current.pending, params.state)})
					return found
				}),
				writes.withPermit,
				failed('Cannot finish the connection')
			)
			yield* pipe(
				writes.withPermit(
					Effect.gen(function* () {
						const connection = yield* get(pending.id)
						if (connection.metadata === undefined) {
							return yield* AuthError.make({message: 'Invalid stored authorization server'})
						}
						if (params.error !== undefined || params.code === undefined) {
							return yield* AuthError.make({
								message: `The provider declined the connection (${params.error ?? 'no code'})`
							})
						}
						if (
							(params.iss !== undefined && params.iss !== connection.metadata.issuer) ||
							(connection.metadata.authorization_response_iss_parameter_supported === true &&
								params.iss !== connection.metadata.issuer)
						) {
							return yield* AuthError.make({message: 'The answer came from another authorization server'})
						}
						yield* exchange(connection, {
							code: params.code,
							code_verifier: pending.verifier,
							grant_type: 'authorization_code',
							redirect_uri: CALLBACK
						})
					})
				),
				Effect.timeout('30 seconds'),
				Effect.catch(cause => fail(pending.id, cause))
			)
		})
		const change = Effect.fnUntraced(function* (id: ServerId, user: User, remove: boolean) {
			yield* people.admin(user)
			yield* writes.withPermit(
				Effect.gen(function* () {
					const connection = yield* get(id)
					const current = yield* Ref.get(state)
					yield* save({
						connections: Boolean.match(remove, {
							onFalse: () => ({
								...current.connections,
								[id]: {...Struct.omit(connection, ['error', 'token', 'tools']), enabled: false}
							}),
							onTrue: () => Record.remove(current.connections, id)
						}),
						pending: Record.filter(current.pending, entry => entry.id !== id)
					})
				})
			)
		}, failed('Cannot change this MCP connection'))
		return Connections.of({
			add,
			begin,
			complete,
			definitions: Effect.map(Ref.get(state), current => Record.values(current.connections)),
			disconnect: (id, user) => change(id, user, false),
			get,
			list,
			remove: (id, user) => change(id, user, true),
			// A discovery's outcome: its tool count clears an earlier failure, a failure keeps the last count.
			report: Effect.fnUntraced(function* (id, generation, outcome) {
				return yield* pipe(
					writes.withPermit(
						Effect.gen(function* () {
							const current = (yield* Ref.get(state)).connections[id]
							if (current?.generation !== generation || !current.enabled) return
							const next: Connection = Match.valueTags(outcome, {
								Discovered: found => ({...Struct.omit(current, ['error']), tools: found.tools}),
								Failed: failure => ({...current, error: failure.error})
							})
							if (next.tools !== current.tools || next.error !== current.error) yield* put(next)
						})
					),
					Effect.ignore({log: 'Warn', message: 'Cannot save the MCP discovery outcome'})
				)
			}),
			token,
			watch: user =>
				pipe(
					changes.watch(
						Effect.gen(function* () {
							yield* people.admin(user)
							const now = yield* Clock.currentTimeMillis
							const definitions = Record.values((yield* Ref.get(state)).connections)
							return {
								// A connection without a refresh token turns Expired on its own, so the list is read again then.
								expiresAt: Array.reduce(
									Array.filter(
										definitions,
										row =>
											row.enabled &&
											row.mode === 'oauth' &&
											row.token !== undefined &&
											row.token.refresh_token === undefined &&
											row.expiresAt > now
									),
									Infinity,
									(earliest, row) => Number.min(earliest, row.expiresAt)
								),
								list: Array.map(definitions, row => connectionInfo(row, now))
							}
						}),
						read => read.expiresAt
					),
					Stream.map(read => read.list)
				)
		})
	})
	static readonly layer = pipe(
		Layer.effect(Connections)(Connections.make),
		Layer.provide(
			Layer.unwrap(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem
					const path = yield* Path.Path
					const directory = path.join(yield* Config.String('HOME'), '.deslop', 'auth', 'mcp')
					yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
					return layerKeyValueStore(directory)
				})
			)
		)
	)
}
