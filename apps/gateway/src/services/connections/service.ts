import {
	Array,
	Boolean,
	Cache,
	Clock,
	Config,
	Context,
	Effect,
	Layer,
	Match,
	Option,
	Redacted,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {
	StreamableHTTPClientTransport,
	discoverAuthorizationServerMetadata,
	discoverOAuthServerInfo,
	extractWWWAuthenticateParams,
	startAuthorization,
	validateAuthorizationResponseIssuer
} from '@modelcontextprotocol/client'
import {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import type {Headers} from 'effect/http'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Auth, adminIds, requireAdmin} from '@deslop/runtime/server/auth'
import type {User} from '@deslop/runtime/shared/auth'
import {AuthError, ISSUER_PATH} from '@deslop/runtime/shared/auth'

import {
	clientMetadata,
	connectionFailure,
	describe,
	endSession,
	mcpClient,
	serverIcons,
	serverName
} from '#services/connections/lib/utils.ts'
import type {
	Callback,
	ConnectionItem,
	Discovery,
	McpUsageReport,
	OAuthClient,
	ServerId,
	ServerUrl
} from '#services/connections/schema.ts'
import {
	Connection,
	ConnectionCalls,
	ConnectionGrant,
	ConnectionState,
	McpUsageServer,
	Metadata,
	Registration,
	Token,
	UpstreamError
} from '#services/connections/schema.ts'
import {usageWindow} from '#services/usage/lib/utils.ts'
import type {Period} from '#services/usage/schema.ts'
import {UsageRange} from '#services/usage/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly connections: never
		readonly connectionCalls: never
	}
}

export const gatewayUrl = Config.String('APP_URL')

// A provider sign-in in progress, for ten minutes and in memory: a restart asks to connect again.
type Pending = {
	client: OAuthClient
	generation: string
	id: ServerId
	metadata: Metadata
	userId: string
	verifier: string
}

function siteOf(url: URL) {
	return pipe(String.split(url.hostname, '.'), Array.drop(1), Array.join('.'))
}

function asAuthError(message: string) {
	return Effect.mapError(connectionFailure(message))
}

const asStorageAuthError = asAuthError('MCP storage failed')

// The server's columns an update writes, to change only some of them.
function editable(connection: Connection) {
	return Struct.pick(connection, Struct.keys(Connection.update.fields))
}

const removedServer = AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'})

// A provider that registers clients gets one per connection, with that server's own callback; otherwise it must name itself in its answers.
function connectable(metadata: Metadata) {
	if (
		metadata.registration_endpoint !== undefined ||
		(metadata.client_id_metadata_document_supported === true &&
			metadata.authorization_response_iss_parameter_supported === true)
	) {
		return Effect.void
	}
	return Effect.fail(
		AuthError.make({
			message:
				'This provider neither registers clients nor names itself in its answers, so the gateway cannot connect to it safely.'
		})
	)
}

export class Connections extends Context.Service<
	Connections,
	{
		readonly add: (url: ServerUrl, user: User, headers: Headers.Headers) => Effect.Effect<ConnectionItem, AuthError>
		readonly begin: (id: ServerId, user: User) => Effect.Effect<{state: Option.Option<string>; url: string}, AuthError>
		readonly called: (id: ServerId) => Effect.Effect<void>
		// `route` is the server id a registered client's callback carries; the metadata document's callback carries none.
		readonly complete: (params: Callback, route: Option.Option<string>, user: User) => Effect.Effect<void, AuthError>
		readonly definitions: Effect.Effect<ConnectionState[], AuthError>
		readonly get: (id: ServerId) => Effect.Effect<ConnectionState, AuthError>
		readonly remove: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly report: (id: ServerId, generation: string, outcome: Discovery) => Effect.Effect<void>
		readonly token: (id: ServerId, generation: string, rejectedToken?: string) => Effect.Effect<string, AuthError>
		// Each proxied call, summed into the period's buckets by server, in a window that reopens at each bucket boundary.
		readonly usage: (period: Period) => Stream.Stream<{range: UsageRange; report: McpUsageReport}, AuthError>
		readonly watch: (user: User) => Stream.Stream<ConnectionItem[], AuthError>
	}
>()('@deslop/gateway/services/connections/service/Connections') {
	static readonly make = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const origin = yield* gatewayUrl
		const callback = `${origin}/oauth/callback`
		const clientInfo = clientMetadata(origin)
		const auth = yield* Auth
		const authUrl = Option.map(yield* Config.option(Config.String('AUTH_URL')), url => new URL(url))
		// The caller's token opens every Deslop app, so only an HTTPS app on Auth's own site that names Auth receives it; any other server naming Auth stays third-party.
		function deslop(url: string, authorizationServers: readonly string[]) {
			const target = new URL(url)
			return Option.exists(
				authUrl,
				issuer =>
					target.protocol === 'https:' &&
					String.isEmpty(target.port) &&
					siteOf(target) === siteOf(issuer) &&
					Array.contains(authorizationServers, new URL(ISSUER_PATH, issuer).href)
			)
		}
		function clientIdOf(client: OAuthClient) {
			return Match.valueTags(client, {Document: () => clientInfo.client_id, Registered: found => found.clientId})
		}

		const connections = yield* SqlModel.makeRepository(Connection, {
			idColumn: 'id',
			spanPrefix: 'Connections',
			tableName: Connection.table
		})
		// Each server's row with its status as of `now`.
		function states(now: number) {
			return sql`
				SELECT ${sql(Connection.table)}.*, CASE
					WHEN mode <> 'oauth' THEN 'Connected'
					WHEN serverId IS NULL THEN 'Not connected'
					WHEN expiresAt <= ${now} AND refreshToken IS NULL THEN 'Expired'
					ELSE 'Connected'
				END AS status
				FROM ${sql(Connection.table)} LEFT JOIN ${sql(ConnectionGrant.table)} ON serverId = id
			`
		}
		// In the order they were added.
		const listStates = SqlSchema.findAll({
			Request: Schema.Finite,
			Result: ConnectionState,
			execute: now => sql`${states(now)} ORDER BY ${sql(Connection.table)}.rowid`
		})
		const findState = SqlSchema.findOneOption({
			Request: Schema.Struct({id: Connection.fields.id, now: Schema.Finite}),
			Result: ConnectionState,
			execute: request => sql`${states(request.now)} WHERE id = ${request.id}`
		})
		const findTaken = SqlSchema.findAll({
			Request: Schema.Struct(Struct.pick(Connection.fields, ['id', 'url'])),
			Result: Schema.Struct(Struct.pick(Connection.fields, ['id', 'url'])),
			execute: request =>
				sql`SELECT id, url FROM ${sql(Connection.table)} WHERE id = ${request.id} OR url = ${request.url}`
		})
		const deleteConnection = SqlSchema.findAll({
			Request: Connection.fields.id,
			Result: Schema.Struct(Struct.pick(Connection.fields, ['id'])),
			execute: id => sql`DELETE FROM ${sql(Connection.table)} WHERE id = ${id} RETURNING id`
		})
		const findGrant = SqlSchema.findOneOption({
			Request: ConnectionGrant.fields.serverId,
			Result: ConnectionGrant,
			execute: id => sql`SELECT * FROM ${sql(ConnectionGrant.table)} WHERE serverId = ${id}`
		})
		const saveGrant = SqlSchema.void({
			Request: ConnectionGrant.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(ConnectionGrant.table)} ${sql.insert(row)}`
		})
		// A grant whose refresh token the provider refused shows Expired until it is connected again; a token another call already renewed is left alone.
		const endGrant = SqlSchema.void({
			Request: Schema.Struct({refreshToken: Schema.String, serverId: ConnectionGrant.fields.serverId}),
			execute: request => sql`
				UPDATE ${sql(ConnectionGrant.table)} SET expiresAt = 0, refreshToken = NULL
				WHERE serverId = ${request.serverId} AND refreshToken = ${request.refreshToken}
			`
		})
		const countCall = SqlSchema.void({
			Request: ConnectionCalls.insert,
			execute: row => sql`
				INSERT INTO ${sql(ConnectionCalls.table)} ${sql.insert(row)}
				ON CONFLICT (serverId, hour) DO UPDATE SET calls = calls + excluded.calls
			`
		})
		const deleteCallsBefore = SqlSchema.void({
			Request: Schema.Struct({hour: Schema.Finite, serverId: ConnectionCalls.fields.serverId}),
			execute: request =>
				sql`DELETE FROM ${sql(ConnectionCalls.table)} WHERE serverId = ${request.serverId} AND hour < ${request.hour}`
		})
		// Every server, with its calls summed into the range's buckets.
		const listCalls = SqlSchema.findAll({
			Request: UsageRange,
			Result: Schema.Struct({...McpUsageServer.fields, series: Schema.fromJsonString(McpUsageServer.fields.series)}),
			execute: range => sql`
				SELECT id, (
					SELECT json_group_array(json_object('at', at, 'calls', calls)) FROM (
						SELECT hour - hour % ${range.size} AS at, sum(calls) AS calls FROM ${sql(ConnectionCalls.table)}
						WHERE serverId = ${sql(Connection.table)}.id AND hour >= ${range.from} AND hour < ${range.to}
						GROUP BY 1 ORDER BY 1
					)
				) AS series
				FROM ${sql(Connection.table)}
				ORDER BY rowid
			`
		})

		// Auth's admins, named by the same setting: only they manage the servers everyone with access shares.
		const admins = yield* adminIds
		function admin(user: User) {
			return requireAdmin(admins, user, 'Only an admin can manage MCP servers')
		}
		// Each server's token is read and refreshed one call at a time, so concurrent calls never spend its refresh token twice.
		const locks = yield* Cache.make<string, Semaphore.Semaphore>({capacity: 256, lookup: () => Semaphore.make(1)})
		const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const fetch = yield* FetchHttpClient.Fetch
		const random = yield* SecureRandom.SecureRandom
		const pending = yield* Cache.make<string, Pending, AuthError>({
			capacity: 64,
			lookup: () => Effect.fail(AuthError.make({message: 'The connection expired; connect it again'})),
			timeToLive: '10 minutes'
		})
		const callbacks = yield* Semaphore.make(1)
		const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)

		// The server as it is now, if it is still the one a piece of work began with.
		function current(id: ServerId, generation: string) {
			return pipe(
				connections.findById(id),
				Effect.catchNoSuchElement,
				Effect.map(Option.filter(found => found.generation === generation))
			)
		}
		// The server is read again inside the write, so one removed or replaced meanwhile is left alone.
		function change(
			id: ServerId,
			generation: string,
			patch: (connection: Connection) => Partial<typeof Connection.update.Type>
		) {
			return pipe(
				current(id, generation),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.void,
						onSome: found => connections.updateVoid({...editable(found), ...patch(found)})
					})
				),
				Reactivity.mutation(['connections']),
				sql.withTransaction,
				withReactivity,
				asStorageAuthError
			)
		}
		// New tokens land with the client they were issued to, and clear the server's last failure.
		function authorize(generation: string, grant: typeof ConnectionGrant.insert.Type) {
			return pipe(
				current(grant.serverId, generation),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.void,
						onSome: found =>
							Effect.andThen(saveGrant(grant), connections.updateVoid({...editable(found), error: Option.none()}))
					})
				),
				Reactivity.mutation(['connections']),
				sql.withTransaction,
				withReactivity,
				asStorageAuthError
			)
		}
		const get = Effect.fnUntraced(function* (id: ServerId) {
			return yield* pipe(
				findState({id, now: yield* Clock.currentTimeMillis}),
				asStorageAuthError,
				Effect.flatMap(Option.match({onNone: () => Effect.fail(removedServer), onSome: Effect.succeed}))
			)
		})
		const definitions = Effect.flatMap(Clock.currentTimeMillis, now => asStorageAuthError(listStates(now)))
		const list = Effect.map(
			definitions,
			Array.map(row => Struct.pick(row, ['error', 'icons', 'id', 'name', 'status', 'tools', 'url']))
		)
		const register = Effect.fnUntraced(function* (metadata: Metadata, id: ServerId) {
			if (metadata.registration_endpoint !== undefined) {
				return yield* pipe(
					HttpClientRequest.bodyJson(HttpClientRequest.post(metadata.registration_endpoint), {
						...Struct.omit(clientInfo, ['client_id']),
						redirect_uris: [`${callback}/${id}`]
					}),
					Effect.flatMap(request => http.execute(request)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Registration)),
					Effect.map(found => ({_tag: 'Registered' as const, clientId: found.client_id}))
				)
			}
			yield* connectable(metadata)
			return {_tag: 'Document' as const}
		})
		const exchange = Effect.fnUntraced(function* (
			connection: Pick<Connection, 'generation' | 'id' | 'url'>,
			issued: Pick<ConnectionGrant, 'clientId' | 'tokenEndpoint'>,
			params: Record<string, string>
		) {
			// The refresh token this exchange spends, if it renews a grant.
			const spent = Option.filter(
				Option.fromUndefinedOr(params['refresh_token']),
				() => params['grant_type'] === 'refresh_token'
			)
			const token = yield* pipe(
				HttpClientRequest.post(issued.tokenEndpoint),
				HttpClientRequest.bodyUrlParams({...params, client_id: issued.clientId, resource: connection.url}),
				request => http.execute(request),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
				Effect.tapErrorTag('HttpClientError', cause => {
					// Only 400 and 401 reject the grant itself; a rate limit or a timeout leaves it to the next try.
					if (cause.reason._tag !== 'StatusCodeError' || !Array.contains([400, 401], cause.reason.response.status)) {
						return Effect.void
					}
					return Option.match(spent, {
						onNone: () => Effect.void,
						onSome: refreshToken =>
							pipe(
								endGrant({refreshToken, serverId: connection.id}),
								Reactivity.mutation(['connections']),
								withReactivity,
								asStorageAuthError
							)
					})
				}),
				Effect.timeout('20 seconds')
			)
			yield* authorize(connection.generation, {
				accessToken: token.access_token,
				clientId: issued.clientId,
				expiresAt: (yield* Clock.currentTimeMillis) + (token.expires_in ?? 3600) * 1000,
				// A refresh answer may leave the refresh token out, which keeps the one it spent.
				refreshToken: Option.orElse(Option.fromUndefinedOr(token.refresh_token), () =>
					Option.map(spent, Redacted.make)
				),
				serverId: connection.id,
				tokenEndpoint: issued.tokenEndpoint
			})
			return Redacted.value(token.access_token)
		})

		const discover = Effect.fnUntraced(function* (
			initial: Pick<Connection, 'generation' | 'id' | 'name' | 'url'>,
			headers: Headers.Headers
		) {
			const probe = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				id: 1,
				jsonrpc: '2.0',
				method: 'tools/list',
				params: {}
			})
			const response = yield* Effect.tryPromise({
				catch: cause => UpstreamError.make({cause}),
				try: signal =>
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
			})
			const challenge = extractWWWAuthenticateParams(response)
			yield* Option.match(Option.fromNullishOr(response.body), {
				onNone: () => Effect.void,
				onSome: Effect.fnUntraced(function* (body) {
					yield* Effect.tryPromise({catch: cause => UpstreamError.make({cause}), try: () => body.cancel()})
				})
			})
			const discovery = yield* Effect.tryPromise({
				catch: cause => UpstreamError.make({cause}),
				try: signal =>
					discoverOAuthServerInfo(initial.url, {
						fetchFn: (target, init) =>
							fetch(target, {
								...init,
								signal: AbortSignal.any([signal, ...Option.toArray(Option.fromNullishOr(init?.signal))])
							}),
						resourceMetadataUrl: challenge.resourceMetadataUrl
					})
			})
			if (discovery.resourceMetadata !== undefined && discovery.resourceMetadata.resource !== initial.url) {
				return yield* AuthError.make({message: 'The MCP metadata names a different resource URL.'})
			}
			const own = deslop(initial.url, discovery.resourceMetadata?.authorization_servers ?? [])
			if (own || discovery.authorizationServerMetadata === undefined) {
				const access = yield* Boolean.match(own, {onFalse: () => Effect.undefined, onTrue: () => auth.token(headers)})
				const transport = new StreamableHTTPClientTransport(new URL(initial.url), {
					authProvider: {
						token: () =>
							// oxlint-disable-next-line no-restricted-properties -- The MCP SDK's token contract requires a Promise.
							Effect.runPromise(Effect.succeed(access))
					},
					fetch,
					requestInit: {redirect: 'error'}
				})
				const anonymous = yield* Effect.acquireRelease(Effect.sync(mcpClient), acquired =>
					endSession(transport, acquired, cause => UpstreamError.make({cause}), 'anonymous')
				)
				yield* Effect.tryPromise({
					catch: cause => UpstreamError.make({cause}),
					try: signal => anonymous.connect(transport, {signal})
				})
				const tools = yield* Effect.tryPromise({
					catch: cause => UpstreamError.make({cause}),
					try: signal => anonymous.listTools(undefined, {signal})
				})
				return {
					...initial,
					error: Option.none(),
					icons: serverIcons(anonymous.getServerVersion()),
					instructions: Option.fromUndefinedOr(anonymous.getInstructions()),
					issuer: Option.none(),
					mode: Boolean.match(own, {onFalse: () => 'public' as const, onTrue: () => 'deslop' as const}),
					name: pipe(
						Option.fromUndefinedOr(anonymous.getServerVersion()?.name),
						Option.map(String.trim),
						Option.filter(String.isNonEmpty),
						Option.getOrElse(() => initial.name)
					),
					scope: Option.none(),
					tools: Array.length(tools.tools)
				} satisfies typeof Connection.insert.Type
			}
			const metadata = yield* Schema.decodeEffect(Metadata)(discovery.authorizationServerMetadata)
			yield* connectable(metadata)
			return {
				...initial,
				error: Option.none(),
				icons: [],
				instructions: Option.none(),
				issuer: Option.some(metadata.issuer),
				mode: 'oauth',
				name: pipe(
					Option.fromUndefinedOr(discovery.resourceMetadata?.resource_name),
					Option.map(String.trim),
					Option.filter(String.isNonEmpty),
					Option.getOrElse(() => initial.name)
				),
				scope: Option.some(challenge.scope ?? Array.join(discovery.resourceMetadata?.scopes_supported ?? [], ' ')),
				tools: 0
			} satisfies typeof Connection.insert.Type
		})
		const fail = Effect.fnUntraced(function* (connection: ConnectionState, cause: unknown) {
			const message = describe(cause)
			yield* change(connection.id, connection.generation, () => ({error: Option.some(message)}))
			if (Schema.is(AuthError)(cause)) return yield* cause
			return yield* AuthError.make({cause, error: 'temporarily_unavailable', message})
		})

		return Connections.of({
			add: Effect.fn('Connections.add')(
				function* (input: ServerUrl, user: User, headers: Headers.Headers) {
					yield* admin(user)
					const url = new URL(input).href
					if (new URL(url).origin === origin) {
						return yield* AuthError.make({message: 'The gateway cannot connect to itself'})
					}
					const added = AuthError.make({message: 'This MCP has already been added.'})
					const base = serverName(url) || 'mcp'
					const taken = yield* asStorageAuthError(findTaken({id: base, url}))
					if (Array.some(taken, row => row.url === url)) return yield* added
					const suffix = String.slice(0, 6)(String.toLowerCase(yield* nonce))
					const id = pipe(
						taken,
						Array.some(row => row.id === base),
						Boolean.match({onFalse: () => base, onTrue: () => `${base}_${suffix}`})
					)
					const connection = yield* discover(
						{generation: yield* nonce, id, name: String.capitalize(base), url},
						headers
					)
					// Discovery takes seconds, so the URL and id are checked again where the server is saved.
					yield* pipe(
						Effect.gen(function* () {
							if (Array.isReadonlyArrayNonEmpty(yield* findTaken({id, url}))) return yield* added
							yield* connections.insertVoid(connection)
						}),
						Reactivity.mutation(['connections']),
						sql.withTransaction,
						withReactivity
					)
					return Struct.pick(yield* get(id), ['error', 'icons', 'id', 'name', 'status', 'tools', 'url'])
				},
				Effect.scoped,
				Effect.timeout('20 seconds'),
				asAuthError('Cannot add this MCP. Check its public HTTPS URL and OAuth discovery support')
			),
			begin: Effect.fn('Connections.begin')(function* (id: ServerId, user: User) {
				yield* admin(user)
				const connection = yield* get(id)
				const oauth = Option.getOrUndefined(Option.all({issuer: connection.issuer, scope: connection.scope}))
				if (oauth === undefined) {
					yield* change(id, connection.generation, () => ({error: Option.none()}))
					return {state: Option.none<string>(), url: '/'}
				}
				return yield* pipe(
					Effect.gen(function* () {
						// Check the provider's current capabilities before authorization.
						const metadata = yield* Schema.decodeUnknownEffect(Metadata)(
							yield* Effect.tryPromise({
								catch: cause => UpstreamError.make({cause}),
								try: signal =>
									discoverAuthorizationServerMetadata(oauth.issuer, {
										fetchFn: (target, init) =>
											fetch(target, {
												...init,
												signal: AbortSignal.any([signal, ...Option.toArray(Option.fromNullishOr(init?.signal))])
											})
									})
							})
						)
						if (!Array.contains(metadata.code_challenge_methods_supported ?? [], 'S256')) {
							return yield* AuthError.make({
								message: 'The provider must advertise S256 PKCE and safe authorization endpoints.'
							})
						}
						// Each connection registers anew, so a client registered for an earlier callback is never reused; the server keeps its grant until the new client has tokens.
						const registered = yield* register(metadata, id)
						const stateId = yield* nonce
						const authorization = yield* Effect.tryPromise({
							catch: cause => UpstreamError.make({cause}),
							try: () =>
								startAuthorization(metadata.issuer, {
									clientInformation: {client_id: clientIdOf(registered)},
									metadata: {
										...metadata,
										code_challenge_methods_supported: [...(metadata.code_challenge_methods_supported ?? [])],
										response_types_supported: [...(metadata.response_types_supported ?? [])]
									},
									redirectUrl: Match.valueTags(registered, {
										Document: () => callback,
										Registered: () => `${callback}/${id}`
									}),
									resource: connection.url,
									scope: oauth.scope,
									state: stateId
								})
						})
						yield* Cache.set(pending, stateId, {
							client: registered,
							generation: connection.generation,
							id,
							metadata,
							userId: user.id,
							verifier: authorization.codeVerifier
						})
						return {state: Option.some(stateId), url: authorization.authorizationUrl.href}
					}),
					Effect.timeout('20 seconds'),
					Effect.catch(cause => fail(connection, cause))
				)
			}, asAuthError('Cannot connect this MCP')),
			// The bar's longest period: an hour older than 30 days goes as a new call arrives.
			called: Effect.fnUntraced(function* (id) {
				const now = yield* Clock.currentTimeMillis
				yield* pipe(
					Effect.andThen(
						countCall({calls: 1, hour: Math.floor(now / 3_600_000) * 3_600_000, serverId: id}),
						deleteCallsBefore({hour: now - 30 * 86_400_000, serverId: id})
					),
					Reactivity.mutation(['connectionCalls']),
					sql.withTransaction,
					withReactivity,
					Effect.catchCause(cause => Effect.logWarning('MCP usage could not be recorded', cause))
				)
			}),
			complete: Effect.fn('Connections.complete')(function* (
				params: Callback,
				route: Option.Option<string>,
				user: User
			) {
				yield* admin(user)
				// The flow is taken once, whatever the provider answered.
				const flow = yield* pipe(
					Cache.getOption(pending, params.state),
					Effect.tap(() => Cache.invalidate(pending, params.state)),
					Effect.flatMap(
						Option.match({
							onNone: () => AuthError.make({message: 'The connection expired; connect it again'}),
							onSome: Effect.succeed
						})
					),
					Effect.uninterruptible,
					Semaphore.withPermit(callbacks)
				)
				const connection = yield* get(flow.id)
				if (flow.userId !== user.id || flow.generation !== connection.generation || connection.mode !== 'oauth') {
					return yield* AuthError.make({message: 'The connection expired; connect it again'})
				}
				yield* pipe(
					Effect.gen(function* () {
						if (params.error !== undefined || params.code === undefined) {
							return yield* AuthError.make({
								message: `The provider declined the connection (${params.error ?? 'no code'})`
							})
						}
						// RFC 9700 §4.4.2: the answer must come from this server's authorization server, by its own callback or its issuer.
						const fromIssuer = Match.valueTags(flow.client, {
							Document: () => Option.isNone(route),
							Registered: () => Option.contains(route, connection.id)
						})
						if (!fromIssuer) {
							return yield* AuthError.make({message: 'The answer came from another authorization server'})
						}
						yield* Effect.try({
							catch: cause => AuthError.make({cause, message: 'The answer came from another authorization server'}),
							try: () =>
								validateAuthorizationResponseIssuer({
									expectedIssuer: flow.metadata.issuer,
									iss: params.iss,
									issParameterSupported:
										flow.client._tag === 'Document' ||
										flow.metadata.authorization_response_iss_parameter_supported === true
								})
						})
						yield* exchange(
							connection,
							{clientId: clientIdOf(flow.client), tokenEndpoint: flow.metadata.token_endpoint},
							{
								code: params.code,
								code_verifier: flow.verifier,
								grant_type: 'authorization_code',
								redirect_uri: Match.valueTags(flow.client, {
									Document: () => callback,
									Registered: () => `${callback}/${connection.id}`
								})
							}
						)
					}),
					Effect.timeout('30 seconds'),
					Effect.catch(cause => fail(connection, cause))
				)
			}, asAuthError('Cannot finish the connection')),
			definitions,
			get,
			// The server's grant and calls go with it.
			remove: Effect.fn('Connections.remove')(function* (id: ServerId, user: User) {
				yield* admin(user)
				const removed = yield* pipe(
					deleteConnection(id),
					Reactivity.mutation(['connections', 'connectionCalls']),
					withReactivity,
					asAuthError('Cannot change this MCP connection')
				)
				if (Array.isReadonlyArrayEmpty(removed)) return yield* removedServer
			}),
			report: Effect.fnUntraced(function* (id, generation, outcome) {
				yield* Effect.ignore(
					change(id, generation, () =>
						Match.valueTags(outcome, {
							Discovered: discovered => ({
								error: Option.none(),
								icons: discovered.icons,
								instructions: Option.fromUndefinedOr(discovered.instructions),
								tools: Array.length(discovered.tools)
							}),
							Failed: failure => ({error: Option.some(failure.error)})
						})
					),
					{log: 'Warn', message: 'Cannot save the MCP discovery outcome'}
				)
			}),
			token: Effect.fn('Connections.token')(function* (id: ServerId, generation: string, rejectedToken?: string) {
				// The grant is read under its server's lock, so a call that waited sees the token the one before it saved.
				return yield* Semaphore.withPermit(
					yield* Cache.get(locks, id),
					Effect.timeout(
						Effect.gen(function* () {
							const connection = yield* get(id)
							if (connection.generation !== generation) {
								return yield* AuthError.make({message: 'This MCP connection was replaced.'})
							}
							const now = yield* Clock.currentTimeMillis
							return yield* Option.match(yield* asStorageAuthError(findGrant(id)), {
								onNone: () => Effect.fail(AuthError.make({message: `Connect ${connection.name} on ${origin}`})),
								onSome: grant => {
									// A token that can be refreshed is renewed 30 seconds early; one that cannot is used to its end.
									const margin = Option.match(grant.refreshToken, {onNone: () => 0, onSome: () => 30_000})
									const access = Redacted.value(grant.accessToken)
									if (access !== rejectedToken && grant.expiresAt > now + margin) return Effect.succeed(access)
									return Option.match(grant.refreshToken, {
										onNone: () =>
											Effect.fail(AuthError.make({message: `Reconnect ${connection.name}; its authorization expired`})),
										onSome: refresh =>
											exchange(connection, grant, {grant_type: 'refresh_token', refresh_token: Redacted.value(refresh)})
									})
								}
							})
						}),
						'20 seconds'
					)
				)
			}, asAuthError('Cannot refresh this MCP; reconnect it from the MCP page')),
			usage: period =>
				usageWindow(period, range =>
					Stream.mapError(sql.reactive(['connectionCalls'], listCalls(range)), connectionFailure('MCP storage failed'))
				),
			// The list is read again after each change and once a minute, so an expired provider shows as expired.
			watch: user =>
				Stream.unwrap(
					Effect.as(
						admin(user),
						Stream.merge(
							sql.reactive(['connections'], list),
							pipe(
								Stream.tick('1 minute'),
								Stream.drop(1),
								Stream.mapEffect(() => list)
							)
						)
					)
				)
		})
	})

	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_connections': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE connections (
							id TEXT PRIMARY KEY,
							url TEXT NOT NULL UNIQUE,
							generation TEXT NOT NULL,
							mode TEXT NOT NULL,
							name TEXT NOT NULL,
							tools INTEGER NOT NULL,
							icons TEXT NOT NULL,
							instructions TEXT,
							error TEXT,
							issuer TEXT,
							scope TEXT
						) STRICT
					`
					yield* sql`
						CREATE TABLE connection_grants (
							serverId TEXT PRIMARY KEY REFERENCES connections (id) ON DELETE CASCADE,
							accessToken TEXT NOT NULL,
							refreshToken TEXT,
							expiresAt REAL NOT NULL,
							clientId TEXT NOT NULL,
							tokenEndpoint TEXT NOT NULL
						) STRICT
					`
					// Keyed by server first, so a server's period reads as one range of the table.
					yield* sql`
						CREATE TABLE connection_calls (
							serverId TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
							hour INTEGER NOT NULL,
							calls INTEGER NOT NULL,
							PRIMARY KEY (serverId, hour)
						) STRICT, WITHOUT ROWID
					`
				})
			}),
			table: 'connections_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(Connections, Connections.make), Connections.migrations)
}
