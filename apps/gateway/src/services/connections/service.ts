import {
	Array,
	Cache,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Match,
	Option,
	Path,
	Record,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	SubscriptionRef,
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
import {AuthError} from '@deslop/runtime/auth/schema'
import {layerKeyValueStore} from '@deslop/runtime/server'

import {CALLBACK, GATEWAY_URL, connectionInfo, describe, serverName} from '#services/connections/lib/utils.ts'
import type {
	Callback,
	ConnectionInfo,
	Discovery,
	OAuth,
	ServerId,
	ToolVisibility
} from '#services/connections/schema.ts'
import {Connection, ConnectionStore, Metadata, Registration, ServerUrl, Token} from '#services/connections/schema.ts'

const CLIENT_METADATA = `${GATEWAY_URL}/oauth/client.json`

// The gateway's client metadata document, for providers that accept one instead of a registration.
export const CLIENT = {
	client_id: CLIENT_METADATA,
	client_name: 'Deslop MCP gateway',
	grant_types: ['authorization_code', 'refresh_token'],
	redirect_uris: [CALLBACK],
	response_types: ['code'],
	token_endpoint_auth_method: 'none'
}

// A provider sign-in in progress, for ten minutes and in memory: a restart asks to connect again.
type Pending = {client: OAuth['client']; generation: string; id: ServerId; userId: string; verifier: string}

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
		// `route` is the server id a registered client's callback carries; the metadata document's callback carries none.
		readonly complete: (params: Callback, route: Option.Option<string>, user: User) => Effect.Effect<void, AuthError>
		readonly definitions: Effect.Effect<Connection[]>
		readonly disconnect: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly get: (id: ServerId) => Effect.Effect<Connection, AuthError>
		readonly hide: (visibility: ToolVisibility, user: User) => Effect.Effect<void, AuthError>
		readonly list: Effect.Effect<ConnectionInfo[]>
		readonly remove: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly report: (id: ServerId, generation: string, outcome: Discovery) => Effect.Effect<void>
		readonly token: (id: ServerId, generation: string, rejectedToken?: string) => Effect.Effect<string, AuthError>
		readonly watch: (user: User) => Stream.Stream<ConnectionInfo[], AuthError>
	}
>()('@deslop/gateway/services/connections/service/Connections') {
	static readonly make = Effect.gen(function* () {
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, ConnectionStore)
		const fs = yield* FileSystem.FileSystem
		// The previous release kept the servers in Auth and called the owner's apps with delegated tokens: the others move here once, those are dropped, to be added again and connected by OAuth.
		const previous = (yield* Path.Path).join(yield* Config.String('HOME'), '.deslop', 'auth', 'mcp', 'servers')
		if ((yield* fs.exists(previous)) && Option.isNone(yield* store.get('servers'))) {
			yield* store.set(
				'servers',
				Record.filter(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
						yield* fs.readFileString(previous)
					),
					Schema.is(Connection)
				)
			)
		}
		if (yield* fs.exists(previous)) yield* fs.remove(previous)
		const state = yield* SubscriptionRef.make(Option.getOrElse(yield* store.get('servers'), () => ({})))
		const admins = yield* Config.Array(Schema.String, 'GITHUB_ADMINS')
		// Auth's admins, named by the same setting: only they manage the servers everyone with access shares.
		const admin = Effect.fnUntraced(function* (user: User) {
			if (!Array.contains(admins, String.replace('github:', '')(user.id))) {
				return yield* AuthError.make({error: 'access_denied', message: 'Only an admin can manage MCP servers'})
			}
		})
		// Each server's token is read and refreshed one call at a time, so concurrent calls never spend its refresh token twice.
		const locks = yield* Cache.make<string, Semaphore.Semaphore>({capacity: 256, lookup: () => Semaphore.make(1)})
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const fetch = yield* FetchHttpClient.Fetch
		const random = yield* SecureRandom.SecureRandom
		const digest = yield* Digest.Digest
		const pending = yield* Cache.make<string, Pending, AuthError>({
			capacity: 64,
			lookup: () => Effect.fail(AuthError.make({message: 'The connection expired; connect it again'})),
			timeToLive: '10 minutes'
		})
		const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)
		// Every change saves the next connections before memory and the live views see them.
		const change = Effect.fnUntraced(function* <A, E>(
			update: (current: ConnectionStore) => Effect.Effect<readonly [A, ConnectionStore], E>
		) {
			return yield* SubscriptionRef.modifyEffect(state, current =>
				Effect.tap(update(current), result => store.set('servers', result[1]))
			)
		}, Effect.uninterruptible)
		const get = Effect.fnUntraced(function* (id: ServerId) {
			return yield* pipe(
				Record.get(yield* SubscriptionRef.get(state), id),
				Effect.fromOption,
				Effect.mapError(() => AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'}))
			)
		})
		// Changes one server, if it is still the one a step started with.
		const update = Effect.fnUntraced(function* (
			id: ServerId,
			generation: string,
			next: (connection: Connection) => Connection
		) {
			yield* change(current =>
				Effect.succeed([
					undefined,
					Option.match(
						Option.filter(Record.get(current, id), found => found.generation === generation),
						{onNone: () => current, onSome: found => ({...current, [id]: next(found)})}
					)
				] as const)
			)
		})
		const list = Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			return Array.map(Record.values(yield* SubscriptionRef.get(state)), row => connectionInfo(row, now))
		})
		// A provider that registers clients gets one per server, with that server's own callback; otherwise it must name itself in its answers.
		const register = Effect.fnUntraced(function* (metadata: Metadata, id: ServerId) {
			if (metadata.registration_endpoint !== undefined) {
				return yield* pipe(
					HttpClientRequest.bodyJson(HttpClientRequest.post(metadata.registration_endpoint), {
						...Struct.omit(CLIENT, ['client_id']),
						redirect_uris: [`${CALLBACK}/${id}`]
					}),
					Effect.flatMap(request => client.execute(request)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Registration)),
					Effect.map(found => ({_tag: 'Registered' as const, clientId: found.client_id}))
				)
			}
			if (
				metadata.client_id_metadata_document_supported === true &&
				metadata.authorization_response_iss_parameter_supported === true
			) {
				return {_tag: 'Document' as const}
			}
			return yield* AuthError.make({
				message:
					'This provider neither registers clients nor names itself in its answers, so the gateway cannot connect to it safely.'
			})
		})
		const exchange = Effect.fnUntraced(function* (
			connection: Connection,
			oauth: OAuth,
			params: Record<string, string>
		) {
			// A provider that rejects the refresh token it still holds ended the grant: the row shows Expired until it is connected again.
			const ended = Effect.fnUntraced(function* () {
				if (params['grant_type'] !== 'refresh_token') return
				yield* update(connection.id, connection.generation, found => {
					if (found.link._tag !== 'Authorized' || found.link.token.refresh_token !== params['refresh_token']) {
						return found
					}
					return {
						...found,
						link: {_tag: 'Authorized', expiresAt: 0, token: Struct.omit(found.link.token, ['refresh_token'])}
					}
				})
			})
			const token = yield* pipe(
				HttpClientRequest.post(oauth.metadata.token_endpoint),
				HttpClientRequest.bodyUrlParams({
					...params,
					client_id: Match.valueTags(oauth.client, {
						Document: () => CLIENT_METADATA,
						Registered: found => found.clientId
					}),
					resource: connection.url
				}),
				request => client.execute(request),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
				Effect.tapErrorTag('HttpClientError', cause => {
					// Only 400 and 401 reject the grant itself; a rate limit or a timeout leaves it to the next try.
					if (cause.reason._tag !== 'StatusCodeError' || !Array.contains([400, 401], cause.reason.response.status)) {
						return Effect.void
					}
					return ended()
				}),
				Effect.timeout('20 seconds')
			)
			const now = yield* Clock.currentTimeMillis
			// A refresh answer may leave the refresh token out, which keeps the one sent.
			const next = {
				...token,
				...Option.match(
					Option.orElse(Option.fromUndefinedOr(token.refresh_token), () =>
						Option.filter(
							Option.fromUndefinedOr(params['refresh_token']),
							() => params['grant_type'] === 'refresh_token'
						)
					),
					{onNone: () => ({}), onSome: refresh => ({refresh_token: refresh})}
				)
			}
			// The tokens are saved with the client they were issued to.
			yield* update(connection.id, connection.generation, found => ({
				...Struct.omit(found, ['error']),
				link: {_tag: 'Authorized', expiresAt: now + (token.expires_in ?? 3600) * 1000, token: next},
				oauth
			}))
			return next.access_token
		})
		const token = Effect.fn('Connections.token')(function* (id: ServerId, generation: string, rejectedToken?: string) {
			// The connection is read under its server's lock, so a call that waited sees the token the one before it saved.
			return yield* Semaphore.withPermit(
				yield* Cache.get(locks, id),
				pipe(
					Effect.gen(function* () {
						const connection = yield* get(id)
						if (connection.generation !== generation) {
							return yield* AuthError.make({message: 'This MCP connection was replaced.'})
						}
						const now = yield* Clock.currentTimeMillis
						const notConnected = AuthError.make({message: `Connect ${connection.name} on ${GATEWAY_URL}`})
						const oauth = yield* Effect.mapError(
							Effect.fromOption(Option.fromUndefinedOr(connection.oauth)),
							() => notConnected
						)
						return yield* Match.valueTags(connection.link, {
							Authorized: link => {
								// A token that can be refreshed is renewed 30 seconds early; one that cannot is used to its end.
								const margin = Option.match(Option.fromUndefinedOr(link.token.refresh_token), {
									onNone: () => 0,
									onSome: () => 30_000
								})
								if (link.token.access_token !== rejectedToken && link.expiresAt > now + margin) {
									return Effect.succeed(link.token.access_token)
								}
								return Option.match(Option.fromUndefinedOr(link.token.refresh_token), {
									onNone: () =>
										Effect.fail(AuthError.make({message: `Reconnect ${connection.name}; its authorization expired`})),
									onSome: refresh => exchange(connection, oauth, {grant_type: 'refresh_token', refresh_token: refresh})
								})
							},
							Connected: () => Effect.fail(notConnected),
							Disconnected: () => Effect.fail(notConnected)
						})
					}),
					Effect.timeout('20 seconds')
				)
			)
		}, failed('Cannot refresh this MCP; reconnect it from the MCP page'))
		const discover = Effect.fnUntraced(function* (initial: Omit<Connection, 'link' | 'mode'>) {
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
					...Option.match(Option.fromUndefinedOr(anonymous.getInstructions()), {
						onNone: () => ({}),
						onSome: instructions => ({instructions})
					}),
					link: {_tag: 'Connected'},
					mode: 'public',
					name: anonymous.getServerVersion()?.name ?? initial.name,
					tools: Array.map(tools.tools, tool => tool.name)
				} satisfies Connection
			}
			const metadata = yield* Schema.decodeEffect(Metadata)(discovery.authorizationServerMetadata)
			if (!validMetadata(metadata)) {
				return yield* AuthError.make({message: 'The MCP returned unsafe authorization endpoints.'})
			}
			return {
				...initial,
				link: {_tag: 'Disconnected'},
				mode: 'oauth',
				name: discovery.resourceMetadata?.resource_name ?? initial.name,
				oauth: {
					client: yield* register(metadata, initial.id),
					metadata,
					scope: challenge.scope ?? Array.join(discovery.resourceMetadata?.scopes_supported ?? [], ' ')
				}
			} satisfies Connection
		})
		// Records why a step failed on its row, so the MCP page shows it; the failure still reaches the caller.
		const fail = Effect.fnUntraced(function* (connection: Connection, cause: unknown) {
			const message = describe(cause)
			yield* update(connection.id, connection.generation, found => ({...found, error: message}))
			return yield* AuthError.make({cause, message})
		})
		const manage = Effect.fnUntraced(function* (
			id: ServerId,
			user: User,
			next: (connection: Connection) => Option.Option<Connection>
		) {
			yield* admin(user)
			yield* change(current =>
				Effect.gen(function* () {
					const found = yield* Effect.mapError(Effect.fromOption(Record.get(current, id)), () =>
						AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'})
					)
					return [
						undefined,
						Option.match(next(found), {
							onNone: () => Record.remove(current, id),
							onSome: row => ({...current, [id]: row})
						})
					] as const
				})
			)
		}, failed('Cannot change this MCP connection'))

		return Connections.of({
			add: Effect.fn('Connections.add')(
				function* (input: string, user: User) {
					yield* admin(user)
					const url = new URL(yield* Schema.decodeEffect(ServerUrl)(input)).href
					const current = yield* SubscriptionRef.get(state)
					if (Array.some(Record.values(current), row => row.url === url)) {
						return yield* AuthError.make({message: 'This MCP has already been added.'})
					}
					const base = serverName(url) || 'mcp'
					const suffix = String.slice(0, 6)(String.toLowerCase(yield* nonce))
					const id = Option.match(Record.get(current, base), {onNone: () => base, onSome: () => `${base}_${suffix}`})
					const connection = yield* discover({
						generation: yield* nonce,
						hidden: [],
						id,
						name: String.capitalize(base),
						tools: [],
						url
					})
					// Discovery takes seconds, so the URL and id are checked again where the server is saved.
					yield* change(latest => {
						if (Record.has(latest, id) || Array.some(Record.values(latest), row => row.url === url)) {
							return Effect.fail(AuthError.make({message: 'This MCP has already been added.'}))
						}
						return Effect.succeed([undefined, {...latest, [id]: connection}] as const)
					})
					return connectionInfo(connection, yield* Clock.currentTimeMillis)
				},
				Effect.scoped,
				Effect.timeout('20 seconds'),
				failed('Cannot add this MCP. Check its public HTTPS URL and OAuth discovery support')
			),
			begin: Effect.fn('Connections.begin')(function* (id: ServerId, user: User) {
				yield* admin(user)
				const connection = yield* get(id)
				if (connection.oauth === undefined) {
					yield* update(id, connection.generation, found => ({
						...Struct.omit(found, ['error']),
						link: {_tag: 'Connected'}
					}))
					return {state: Option.none<string>(), url: '/'}
				}
				// Each connection registers anew, so a client registered for an earlier callback is never reused; the row keeps its client until the new one has tokens.
				const registered = yield* register(connection.oauth.metadata, id)
				const stateId = yield* nonce
				const verifier = yield* nonce
				yield* Cache.set(pending, stateId, {
					client: registered,
					generation: connection.generation,
					id,
					userId: user.id,
					verifier
				})
				const url = new URL(connection.oauth.metadata.authorization_endpoint)
				url.search = new URLSearchParams({
					client_id: Match.valueTags(registered, {
						Document: () => CLIENT_METADATA,
						Registered: found => found.clientId
					}),
					code_challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier))),
					code_challenge_method: 'S256',
					redirect_uri: Match.valueTags(registered, {Document: () => CALLBACK, Registered: () => `${CALLBACK}/${id}`}),
					resource: connection.url,
					response_type: 'code',
					scope: connection.oauth.scope,
					state: stateId
				}).toString()
				return {state: Option.some(stateId), url: url.href}
			}, failed('Cannot connect this MCP')),
			complete: Effect.fn('Connections.complete')(function* (
				params: Callback,
				route: Option.Option<string>,
				user: User
			) {
				yield* admin(user)
				// The flow is taken once, whatever the provider answered.
				const flow = yield* Cache.get(pending, params.state)
				yield* Cache.invalidate(pending, params.state)
				const connection = yield* get(flow.id)
				if (flow.userId !== user.id || flow.generation !== connection.generation || connection.oauth === undefined) {
					return yield* AuthError.make({message: 'The connection expired; connect it again'})
				}
				const oauth = {...connection.oauth, client: flow.client}
				yield* pipe(
					Effect.gen(function* () {
						if (params.error !== undefined || params.code === undefined) {
							return yield* AuthError.make({
								message: `The provider declined the connection (${params.error ?? 'no code'})`
							})
						}
						// RFC 9700 §4.4.2: the answer must come from this server's authorization server, by its own callback or its issuer.
						const fromIssuer = Match.valueTags(oauth.client, {
							Document: () => params.iss === oauth.metadata.issuer && Option.isNone(route),
							Registered: () =>
								Option.contains(route, connection.id) &&
								(params.iss === undefined || params.iss === oauth.metadata.issuer)
						})
						if (!fromIssuer) {
							return yield* AuthError.make({message: 'The answer came from another authorization server'})
						}
						yield* exchange(connection, oauth, {
							code: params.code,
							code_verifier: flow.verifier,
							grant_type: 'authorization_code',
							redirect_uri: Match.valueTags(oauth.client, {
								Document: () => CALLBACK,
								Registered: () => `${CALLBACK}/${connection.id}`
							})
						})
					}),
					Effect.timeout('30 seconds'),
					Effect.catch(cause => fail(connection, cause))
				)
			}, failed('Cannot finish the connection')),
			definitions: Effect.map(SubscriptionRef.get(state), Record.values),
			disconnect: (id, user) =>
				manage(id, user, found =>
					Option.some({...Struct.omit(found, ['error']), link: {_tag: 'Disconnected' as const}, tools: []})
				),
			get,
			hide: (visibility, user) =>
				manage(visibility.id, user, found =>
					Option.some({
						...found,
						hidden: [
							...Array.filter(found.hidden, tool => tool !== visibility.tool),
							...Array.filter([visibility.tool], () => visibility.hidden)
						]
					})
				),
			list,
			remove: (id, user) => manage(id, user, () => Option.none()),
			// A discovery's outcome: its tools and instructions clear an earlier failure, a failure keeps the last ones.
			report: Effect.fnUntraced(function* (id, generation, outcome) {
				yield* pipe(
					update(id, generation, found =>
						Match.valueTags(outcome, {
							Discovered: discovered => ({
								...Struct.omit(found, ['error', 'instructions']),
								...Struct.pick(discovered, ['instructions']),
								tools: discovered.tools
							}),
							Failed: failure => ({...found, error: failure.error})
						})
					),
					Effect.ignore({log: 'Warn', message: 'Cannot save the MCP discovery outcome'})
				)
			}),
			token,
			// The list is read again on each change and once a minute, so an expired provider shows as expired.
			watch: user =>
				Stream.mapEffect(
					Stream.merge(
						Stream.map(SubscriptionRef.changes(state), () => undefined),
						Stream.drop(Stream.tick('1 minute'), 1)
					),
					() => Effect.andThen(admin(user), list)
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
					const directory = path.join(yield* Config.String('HOME'), '.deslop', 'gateway')
					yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
					return layerKeyValueStore(directory)
				})
			)
		)
	)
}
