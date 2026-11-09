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
	Number,
	Option,
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
import {KeyValueStore} from 'effect/persistence'

import type {User} from '@deslop/runtime/auth/schema'
import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {ISSUER_PATH, adminIds, isAdmin} from '@deslop/runtime/auth/utils'

import {
	clientMetadata,
	connectionInfo,
	describe,
	endSession,
	gatewayUrl,
	mcpClient,
	serverIcons,
	serverName,
	usageSeries
} from '#services/connections/lib/utils.ts'
import type {
	Callback,
	ConnectionInfo,
	Discovery,
	McpUsageReport,
	OAuth,
	ServerId,
	Connection,
	ServerUrl
} from '#services/connections/schema.ts'
import {
	ConnectionStore,
	McpUsageBucket,
	Metadata,
	Registration,
	Token,
	UpstreamError
} from '#services/connections/schema.ts'
import type {Period, UsageRange} from '#services/usage/schema.ts'
import {usageWindow} from '#services/usage/utils.ts'

// A provider sign-in in progress, for ten minutes and in memory: a restart asks to connect again.
type Pending = {
	client: OAuth['client']
	generation: string
	id: ServerId
	metadata: Metadata
	userId: string
	verifier: string
}

function siteOf(url: URL) {
	return Array.join(Array.drop(String.split('.')(url.hostname), 1), '.')
}

function failed(message: string) {
	return Effect.mapError((cause: unknown) => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message: `${message}: ${describe(cause)}`})
	})
}

function usageKey(id: ServerId) {
	return `mcp-usage/${id}`
}

export class Connections extends Context.Service<
	Connections,
	{
		readonly add: (url: ServerUrl, user: User, headers: Headers.Headers) => Effect.Effect<ConnectionInfo, AuthError>
		readonly begin: (id: ServerId, user: User) => Effect.Effect<{state: Option.Option<string>; url: string}, AuthError>
		readonly called: (id: ServerId) => Effect.Effect<void>
		// `route` is the server id a registered client's callback carries; the metadata document's callback carries none.
		readonly complete: (params: Callback, route: Option.Option<string>, user: User) => Effect.Effect<void, AuthError>
		readonly definitions: Effect.Effect<Connection[]>
		readonly get: (id: ServerId) => Effect.Effect<Connection, AuthError>
		readonly list: Effect.Effect<ConnectionInfo[]>
		readonly remove: (id: ServerId, user: User) => Effect.Effect<void, AuthError>
		readonly report: (id: ServerId, generation: string, outcome: Discovery) => Effect.Effect<void>
		readonly token: (id: ServerId, generation: string, rejectedToken?: string) => Effect.Effect<string, AuthError>
		// Each proxied call, summed into the period's buckets by server, in a window that reopens at each bucket boundary.
		readonly usage: (period: Period) => Stream.Stream<{range: UsageRange; report: McpUsageReport}, AuthError>
		readonly watch: (user: User) => Stream.Stream<ConnectionInfo[], AuthError>
	}
>()('@deslop/gateway/services/connections/service/Connections') {
	static readonly make = Effect.gen(function* () {
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
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, ConnectionStore)
		const usage = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Schema.Array(McpUsageBucket))
		const usageLock = yield* Semaphore.make(1)
		// The bar's longest period: an hour older than 30 days is dropped as a new call arrives.
		const recordUsage = Effect.fnUntraced(function* (id: ServerId) {
			const now = yield* Clock.currentTimeMillis
			const at = Math.floor(now / 3_600_000) * 3_600_000
			yield* Semaphore.withPermit(
				usageLock,
				Effect.gen(function* () {
					const buckets = Option.getOrElse(yield* usage.get(usageKey(id)), () => [])
					const calls = Option.getOrElse(
						Option.map(
							Array.findFirst(buckets, bucket => bucket.at === at),
							bucket => bucket.calls
						),
						() => 0
					)
					yield* usage.set(usageKey(id), [
						...Array.filter(buckets, bucket => bucket.at !== at && bucket.at >= now - 30 * 86_400_000),
						{at, calls: calls + 1}
					])
				})
			)
		})
		const state = yield* SubscriptionRef.make(Option.getOrElse(yield* store.get('servers'), () => ({})))
		// A recorded call wakes every open usage reader; reads coalesce, so one report goes out at most each second.
		const usageChanged = yield* SubscriptionRef.make(0)
		const usageReport = Effect.fnUntraced(function* (range: UsageRange) {
			return yield* Effect.forEach(
				Array.map(Record.values(yield* SubscriptionRef.get(state)), row => row.id),
				id =>
					Effect.map(usage.get(usageKey(id)), buckets => ({
						id,
						series: usageSeries(
							Option.getOrElse(buckets, () => []),
							range
						)
					})),
				{concurrency: 1}
			)
		}, failed('MCP usage storage failed'))
		// Auth's admins, named by the same setting: only they manage the servers everyone with access shares.
		const admins = yield* adminIds
		const admin = Effect.fnUntraced(function* (user: User) {
			if (!isAdmin(admins, user.id)) {
				return yield* AuthError.make({error: 'access_denied', message: 'Only an admin can manage MCP servers'})
			}
		})
		// Each server's token is read and refreshed one call at a time, so concurrent calls never spend its refresh token twice.
		const locks = yield* Cache.make<string, Semaphore.Semaphore>({capacity: 256, lookup: () => Semaphore.make(1)})
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const fetch = yield* FetchHttpClient.Fetch
		const random = yield* SecureRandom.SecureRandom
		const pending = yield* Cache.make<string, Pending, AuthError>({
			capacity: 64,
			lookup: () => Effect.fail(AuthError.make({message: 'The connection expired; connect it again'})),
			timeToLive: '10 minutes'
		})
		const callbacks = yield* Semaphore.make(1)
		const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)
		// Every change saves the next connections before memory and the live views see them.
		const change = Effect.fnUntraced(function* <E>(
			update: (current: ConnectionStore) => Effect.Effect<ConnectionStore, E>
		) {
			return yield* SubscriptionRef.updateEffect(state, current =>
				Effect.tap(update(current), next => store.set('servers', next))
			)
		}, Effect.uninterruptible)
		const get = Effect.fnUntraced(function* (id: ServerId) {
			return yield* pipe(
				Record.get(yield* SubscriptionRef.get(state), id),
				Effect.fromOption,
				Effect.mapError(() => AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'}))
			)
		})
		const update = Effect.fnUntraced(function* (
			id: ServerId,
			generation: string,
			next: (connection: Connection) => Connection
		) {
			yield* change(current =>
				Effect.succeed(
					Option.match(
						Option.filter(Record.get(current, id), found => found.generation === generation),
						{onNone: () => current, onSome: found => ({...current, [id]: next(found)})}
					)
				)
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
						...Struct.omit(clientInfo, ['client_id']),
						redirect_uris: [`${callback}/${id}`]
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
						Document: () => clientInfo.client_id,
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
						const notConnected = AuthError.make({message: `Connect ${connection.name} on ${origin}`})
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
		const discover = Effect.fnUntraced(function* (
			initial: Omit<Connection, 'link' | 'mode'>,
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
					...Option.match(Option.fromUndefinedOr(anonymous.getInstructions()), {
						onNone: () => ({}),
						onSome: instructions => ({instructions})
					}),
					icons: serverIcons(anonymous.getServerVersion()),
					link: {_tag: 'Connected'},
					mode: Boolean.match(own, {onFalse: () => 'public' as const, onTrue: () => 'deslop' as const}),
					name: pipe(
						Option.fromUndefinedOr(anonymous.getServerVersion()?.name),
						Option.map(String.trim),
						Option.filter(String.isNonEmpty),
						Option.getOrElse(() => initial.name)
					),
					tools: Array.map(tools.tools, tool => tool.name)
				} satisfies Connection
			}
			const metadata = yield* Schema.decodeEffect(Metadata)(discovery.authorizationServerMetadata)
			return {
				...initial,
				link: {_tag: 'Disconnected'},
				mode: 'oauth',
				name: pipe(
					Option.fromUndefinedOr(discovery.resourceMetadata?.resource_name),
					Option.map(String.trim),
					Option.filter(String.isNonEmpty),
					Option.getOrElse(() => initial.name)
				),
				oauth: {
					client: yield* register(metadata, initial.id),
					metadata,
					scope: challenge.scope ?? Array.join(discovery.resourceMetadata?.scopes_supported ?? [], ' ')
				}
			} satisfies Connection
		})
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
					return Option.match(next(found), {
						onNone: () => Record.remove(current, id),
						onSome: row => ({...current, [id]: row})
					})
				})
			)
		}, failed('Cannot change this MCP connection'))

		return Connections.of({
			add: Effect.fn('Connections.add')(
				function* (input: ServerUrl, user: User, headers: Headers.Headers) {
					yield* admin(user)
					const url = new URL(input).href
					if (new URL(url).origin === origin) {
						return yield* AuthError.make({message: 'The gateway cannot connect to itself'})
					}
					const current = yield* SubscriptionRef.get(state)
					if (Array.some(Record.values(current), row => row.url === url)) {
						return yield* AuthError.make({message: 'This MCP has already been added.'})
					}
					const base = serverName(url) || 'mcp'
					const suffix = String.slice(0, 6)(String.toLowerCase(yield* nonce))
					const id = Option.match(Record.get(current, base), {onNone: () => base, onSome: () => `${base}_${suffix}`})
					const connection = yield* discover(
						{generation: yield* nonce, id, name: String.capitalize(base), tools: [], url},
						headers
					)
					// Discovery takes seconds, so the URL and id are checked again where the server is saved.
					yield* change(latest => {
						if (Record.has(latest, id) || Array.some(Record.values(latest), row => row.url === url)) {
							return Effect.fail(AuthError.make({message: 'This MCP has already been added.'}))
						}
						return Effect.succeed({...latest, [id]: connection})
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
				const oauth = connection.oauth
				if (oauth === undefined) {
					yield* update(id, connection.generation, found => ({
						...Struct.omit(found, ['error']),
						link: {_tag: 'Connected'}
					}))
					return {state: Option.none<string>(), url: '/'}
				}
				return yield* pipe(
					Effect.gen(function* () {
						// Check the provider's current capabilities before authorization, including connections saved by the previous release.
						const metadata = yield* Schema.decodeUnknownEffect(Metadata)(
							yield* Effect.tryPromise({
								catch: cause => UpstreamError.make({cause}),
								try: signal =>
									discoverAuthorizationServerMetadata(oauth.metadata.issuer, {
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
						// Each connection registers anew, so a client registered for an earlier callback is never reused; the row keeps its client until the new one has tokens.
						const registered = yield* register(metadata, id)
						const stateId = yield* nonce
						const authorization = yield* Effect.tryPromise({
							catch: cause => UpstreamError.make({cause}),
							try: () =>
								startAuthorization(metadata.issuer, {
									clientInformation: {
										client_id: Match.valueTags(registered, {
											Document: () => clientInfo.client_id,
											Registered: found => found.clientId
										})
									},
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
			}, failed('Cannot connect this MCP')),
			called: id =>
				Effect.catchCause(
					Effect.tap(recordUsage(id), () => SubscriptionRef.update(usageChanged, Number.increment)),
					cause => Effect.logWarning('MCP usage could not be recorded', cause)
				),
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
				if (flow.userId !== user.id || flow.generation !== connection.generation || connection.oauth === undefined) {
					return yield* AuthError.make({message: 'The connection expired; connect it again'})
				}
				const oauth = {...connection.oauth, client: flow.client, metadata: flow.metadata}
				yield* pipe(
					Effect.gen(function* () {
						if (params.error !== undefined || params.code === undefined) {
							return yield* AuthError.make({
								message: `The provider declined the connection (${params.error ?? 'no code'})`
							})
						}
						// RFC 9700 §4.4.2: the answer must come from this server's authorization server, by its own callback or its issuer.
						const fromIssuer = Match.valueTags(oauth.client, {
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
									expectedIssuer: oauth.metadata.issuer,
									iss: params.iss,
									issParameterSupported:
										oauth.client._tag === 'Document' ||
										oauth.metadata.authorization_response_iss_parameter_supported === true
								})
						})
						yield* exchange(connection, oauth, {
							code: params.code,
							code_verifier: flow.verifier,
							grant_type: 'authorization_code',
							redirect_uri: Match.valueTags(oauth.client, {
								Document: () => callback,
								Registered: () => `${callback}/${connection.id}`
							})
						})
					}),
					Effect.timeout('30 seconds'),
					Effect.catch(cause => fail(connection, cause))
				)
			}, failed('Cannot finish the connection')),
			definitions: Effect.map(SubscriptionRef.get(state), Record.values),
			get,
			list,
			remove: (id, user) =>
				Effect.andThen(
					manage(id, user, () => Option.none()),
					Effect.ignore(usage.remove(usageKey(id)), {log: 'Warn', message: 'Cannot delete the MCP usage'})
				),
			report: Effect.fnUntraced(function* (id, generation, outcome) {
				yield* pipe(
					update(id, generation, found =>
						Match.valueTags(outcome, {
							Discovered: discovered => ({
								...Struct.omit(found, ['error', 'instructions']),
								...Struct.pick(discovered, ['icons', 'instructions']),
								tools: discovered.tools
							}),
							Failed: failure => ({...found, error: failure.error})
						})
					),
					Effect.ignore({log: 'Warn', message: 'Cannot save the MCP discovery outcome'})
				)
			}),
			token,
			usage: period =>
				usageWindow(
					period,
					Stream.map(SubscriptionRef.changes(usageChanged), () => undefined),
					usageReport
				),
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
	static readonly layer = Layer.effect(Connections)(Connections.make)
}
