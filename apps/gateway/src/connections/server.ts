import {
	Array,
	Boolean,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	Match,
	Option,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {discoverOAuthServerInfo, extractWWWAuthenticateParams} from '@modelcontextprotocol/client'
import {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {FetchHttpClient, Headers} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {AuthError, ON_BEHALF_HEADER} from '@deslop/runtime/shared/auth'
import type {Admin} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import type {TimeFrame} from '@deslop/runtime/shared/time'

import {
	Connection,
	ConnectionGeneration,
	ConnectionState,
	McpCall,
	McpUsageServer,
	ServerId,
	UpstreamError
} from './contract.ts'
import type {ConnectionItem, ConnectionTarget, Discovery, McpUsageReport, ServerUrl} from './contract.ts'
import {connectionFailure} from './failure.ts'
import {serverIcons, serverName} from './metadata.ts'
import {migrations} from './migrations.ts'

import {ConnectionGrant, ServerMetadata, connectable} from '#grants/contract.ts'
import {Upstreams} from '#upstreams/server.ts'
import {UsageRange} from '#usage/contract.ts'
import {usageWindow} from '#usage/window.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly connections: never
		readonly connectionCalls: never
	}
}

export const gatewayUrl = Config.String('APP_URL')

const asStorageAuthError = Effect.mapError(connectionFailure('MCP storage failed'))

// The server's columns an update writes, to change only some of them.
function editable(connection: Connection) {
	return Struct.pick(connection, Struct.keys(Connection.update.fields))
}

const removedServer = AuthError.make({message: 'This MCP was removed. Add it again on the MCP page.'})

export class Connections extends Context.Service<
	Connections,
	{
		readonly add: (url: ServerUrl, user: Admin, headers: Headers.Headers) => Effect.Effect<ConnectionItem, AuthError>
		// New tokens land with the client they were issued to, and clear the server's last failure.
		readonly authorize: (
			generation: ConnectionGeneration,
			grant: typeof ConnectionGrant.insert.Type
		) => Effect.Effect<void, AuthError>
		// Counted only while the server is the one the call began with.
		readonly called: (id: ServerId, generation: ConnectionGeneration) => Effect.Effect<void>
		// The server is read again inside the write, so one removed or replaced meanwhile is left alone.
		readonly change: (
			id: ServerId,
			generation: ConnectionGeneration,
			patch: (connection: Connection) => Partial<typeof Connection.update.Type>
		) => Effect.Effect<void, AuthError>
		readonly definitions: Effect.Effect<ConnectionState[], AuthError>
		readonly get: (id: ServerId) => Effect.Effect<ConnectionState, AuthError>
		readonly remove: (id: ServerId, user: Admin) => Effect.Effect<void, AuthError>
		readonly report: (id: ServerId, generation: ConnectionGeneration, outcome: Discovery) => Effect.Effect<void>
		// Each proxied call, summed into the period's buckets by server, in a window that reopens at each bucket boundary.
		readonly usage: (
			period: TimeFrame,
			admin: Admin
		) => Stream.Stream<{range: UsageRange; report: McpUsageReport}, AuthError>
		readonly watch: (user: Admin) => Stream.Stream<ConnectionItem[], AuthError>
	}
>()('@deslop/gateway/connections/server/Connections') {
	static readonly make = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const reactivity = yield* Reactivity.Reactivity
		const withReactivity = Effect.provideService(Reactivity.Reactivity, reactivity)
		const origin = yield* gatewayUrl
		const auth = yield* Auth
		const upstreams = yield* Upstreams
		const parent = pipe(String.split(new URL(origin).hostname, '.'), Array.drop(1), Array.join('.'))
		// Only HTTPS subdomains of Gateway's parent domain receive the caller's identity.
		function deslop(url: string) {
			const target = new URL(url)
			return target.protocol === 'https:' && String.isNonEmpty(parent) && String.endsWith(`.${parent}`)(target.hostname)
		}

		const connections = yield* SqlModel.makeRepository(Connection, {
			idColumn: 'id',
			spanPrefix: 'Connections',
			tableName: Connection.table
		})
		// Each server's row with its status as of `now`.
		function states(now: typeof DateTimeUtcFromFiniteMillis.Encoded) {
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
			Request: DateTimeUtcFromFiniteMillis,
			Result: ConnectionState,
			execute: now => sql`${states(now)} ORDER BY ${sql(Connection.table)}.rowid`
		})
		const findState = SqlSchema.findOneOption({
			Request: Schema.Struct({id: Connection.fields.id, now: DateTimeUtcFromFiniteMillis}),
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
		const saveGrant = SqlSchema.void({
			Request: ConnectionGrant.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(ConnectionGrant.table)} ${sql.insert(row)}`
		})
		const countCall = SqlSchema.void({
			Request: Schema.Struct({...McpCall.fields, generation: ConnectionGeneration}),
			execute: request => sql`
					INSERT INTO ${sql(McpCall.table)} (serverId, at)
					SELECT id, ${request.at} FROM ${sql(Connection.table)}
					WHERE id = ${request.serverId} AND generation = ${request.generation}
				`
		})
		// Every server, with its calls summed into the range's buckets.
		const listCalls = SqlSchema.findAll({
			Request: UsageRange,
			Result: Schema.Struct({...McpUsageServer.fields, series: Schema.fromJsonString(McpUsageServer.fields.series)}),
			execute: range => sql`
					SELECT id, (
						SELECT json_group_array(json_object('at', at, 'calls', calls)) FROM (
							SELECT at - at % ${range.size} AS at, count(*) AS calls FROM ${sql(McpCall.table)}
							WHERE serverId = ${sql(Connection.table)}.id AND at >= ${range.from} AND at < ${range.to}
							GROUP BY 1 ORDER BY 1
						)
					) AS series
					FROM ${sql(Connection.table)}
					ORDER BY rowid
				`
		})
		const fetch = yield* FetchHttpClient.Fetch
		const nonce = Effect.map((yield* SecureRandom.SecureRandom).randomBytes(32), Base64Url.encode)

		// The server as it is now, if it is still the one a piece of work began with.
		function current(id: ServerId, generation: ConnectionGeneration) {
			return pipe(
				connections.findById(id),
				Effect.catchNoSuchElement,
				Effect.map(Option.filter(found => found.generation === generation))
			)
		}
		// The server is read again inside the write, so one removed or replaced meanwhile is left alone.
		function change(
			id: ServerId,
			generation: ConnectionGeneration,
			patch: (connection: Connection) => Partial<typeof Connection.update.Type>
		) {
			return pipe(
				current(id, generation),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.void,
						onSome: found => {
							const before = editable(found)
							const after = {...before, ...patch(found)}
							if (Schema.toEquivalence(Connection.update)(before, after)) return Effect.void
							return Reactivity.mutation(connections.updateVoid(after), ['connections'])
						}
					})
				),
				sql.withTransaction,
				withReactivity,
				asStorageAuthError
			)
		}
		// New tokens land with the client they were issued to, and clear the server's last failure.
		function authorize(generation: ConnectionGeneration, grant: typeof ConnectionGrant.insert.Type) {
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
		// What an address answers to: a Deslop server takes the caller's identity, a public one needs nothing, and a provider with OAuth is read for its authorization server.
		const discover = Effect.fnUntraced(function* (initial: ConnectionTarget, headers: Headers.Headers) {
			const own = deslop(initial.url)
			const access = yield* Boolean.match(own, {
				onFalse: () => Effect.succeed(Headers.empty),
				onTrue: () => Effect.map(auth.user(headers), user => Headers.fromInput({[ON_BEHALF_HEADER]: user.id}))
			})
			const available = Effect.fnUntraced(function* () {
				const found = yield* upstreams.use(
					Effect.succeed({headers: access, url: initial.url}),
					client =>
						Effect.map(client.listTools(), tools => ({
							info: client.serverInfo,
							instructions: client.instructions,
							tools
						})),
					Option.none()
				)
				return {
					...initial,
					error: Option.none(),
					icons: serverIcons(found.info),
					instructions: found.instructions,
					issuer: Option.none(),
					mode: Boolean.match(own, {
						onFalse: Function.constant('public' as const),
						onTrue: Function.constant('deslop' as const)
					}),
					name: pipe(
						Option.map(found.info, server => server.name),
						Option.map(String.trim),
						Option.filter(String.isNonEmpty),
						Option.getOrElse(() => initial.name)
					),
					scope: Option.none(),
					tools: Array.length(found.tools)
				} satisfies typeof Connection.insert.Type
			})
			if (own) return yield* available()
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
			// OAuth discovery must follow the server's advertised challenge and metadata.
			const discovery = yield* Effect.tryPromise({
				catch: cause => UpstreamError.make({cause}),
				try: signal =>
					discoverOAuthServerInfo(initial.url, {
						fetchFn: (target, init) =>
							fetch(target, {
								...init,
								signal: AbortSignal.any([signal, ...Option.toArray(Option.fromNullishOr(init?.signal))])
							}),
						...Option.match(Option.fromUndefinedOr(challenge.resourceMetadataUrl), {
							onNone: () => ({}),
							onSome: resourceMetadataUrl => ({resourceMetadataUrl})
						})
					})
			})
			const resourceMetadata = Option.fromUndefinedOr(discovery.resourceMetadata)
			const authorizationMetadata = Option.fromUndefinedOr(discovery.authorizationServerMetadata)
			if (Option.exists(resourceMetadata, metadata => metadata.resource !== initial.url)) {
				return yield* AuthError.make({message: 'The MCP metadata names a different resource URL.'})
			}
			return yield* Option.match(authorizationMetadata, {
				onNone: available,
				onSome: Effect.fnUntraced(function* (serverMetadata) {
					const metadata = yield* Schema.decodeUnknownEffect(ServerMetadata)(serverMetadata)
					yield* connectable(metadata)
					return {
						...initial,
						error: Option.none(),
						icons: [],
						instructions: Option.none(),
						issuer: Option.some(metadata.issuer),
						mode: 'oauth',
						name: pipe(
							resourceMetadata,
							Option.flatMap(found => Option.fromUndefinedOr(found.resource_name)),
							Option.map(String.trim),
							Option.filter(String.isNonEmpty),
							Option.getOrElse(() => initial.name)
						),
						scope: Option.some(
							challenge.scope ??
								pipe(
									resourceMetadata,
									Option.flatMap(found => Option.fromUndefinedOr(found.scopes_supported)),
									Option.getOrElse(() => []),
									Array.join(' ')
								)
						),
						tools: 0
					} satisfies typeof Connection.insert.Type
				})
			})
		})
		const get = Effect.fn('Connections.get')(function* (id: ServerId) {
			return yield* pipe(
				findState({id, now: yield* DateTime.now}),
				asStorageAuthError,
				Effect.flatMap(Option.match({onNone: () => Effect.fail(removedServer), onSome: Effect.succeed}))
			)
		})
		const definitions = pipe(
			DateTime.now,
			Effect.flatMap(now => asStorageAuthError(listStates(now))),
			Effect.withSpan('Connections.definitions')
		)
		const list = Effect.map(
			definitions,
			Array.map(row => Struct.pick(row, ['error', 'icons', 'id', 'name', 'status', 'tools', 'url']))
		)

		return Connections.of({
			add: Effect.fn('Connections.add')(
				function* (input: ServerUrl, _user: Admin, headers: Headers.Headers) {
					const url = new URL(input).href
					if (new URL(url).origin === origin) {
						return yield* AuthError.make({message: 'The gateway cannot connect to itself'})
					}
					const added = AuthError.make({message: 'This MCP has already been added.'})
					const base = ServerId.make(serverName(url) || 'mcp')
					const taken = yield* asStorageAuthError(findTaken({id: base, url}))
					if (Array.some(taken, row => row.url === url)) return yield* added
					const suffix = pipe(
						yield* nonce,
						String.toLowerCase,
						String.replaceAll(/[^a-z0-9]/gu, ''),
						String.slice(0, 6)
					)
					const id = pipe(
						taken,
						Array.some(row => row.id === base),
						Boolean.match({onFalse: () => base, onTrue: () => ServerId.make(`${base}-${suffix}`)})
					)
					yield* pipe(
						discover(
							{generation: ConnectionGeneration.make(yield* nonce), id, name: String.capitalize(base), url},
							headers
						),
						// Discovery takes seconds, so the URL and id are checked again where the server is saved.
						Effect.flatMap(connection =>
							pipe(
								Effect.gen(function* () {
									if (Array.isReadonlyArrayNonEmpty(yield* findTaken({id, url}))) return yield* added
									yield* connections.insertVoid(connection)
								}),
								Reactivity.mutation(['connections']),
								sql.withTransaction,
								withReactivity
							)
						),
						// Until its row is saved nothing else could end the session discovery opened.
						Effect.onError(() => upstreams.forget(url))
					)
					return Struct.pick(yield* get(id), ['error', 'icons', 'id', 'name', 'status', 'tools', 'url'])
				},
				Effect.scoped,
				Effect.timeout(Duration.seconds(20)),
				Effect.mapError(
					connectionFailure('Cannot add this MCP. Check its public HTTPS URL and OAuth discovery support')
				)
			),
			authorize,
			called: Effect.fn('Connections.called')(function* (id, generation) {
				yield* Effect.annotateCurrentSpan('serverId', id)
				yield* pipe(
					countCall({at: yield* DateTime.now, generation, serverId: id}),
					Reactivity.mutation(['connectionCalls']),
					withReactivity,
					Effect.catchCause(cause => Effect.logWarning('MCP usage could not be recorded', cause))
				)
			}),
			change,
			definitions,
			get,
			// The server's grant and calls go with it.
			remove: Effect.fn('Connections.remove')(function* (id: ServerId) {
				const connection = yield* get(id)
				const removed = yield* pipe(
					deleteConnection(id),
					Reactivity.mutation(['connections', 'connectionCalls']),
					withReactivity,
					Effect.mapError(connectionFailure('Cannot change this MCP connection'))
				)
				if (Array.isReadonlyArrayEmpty(removed)) return yield* removedServer
				yield* upstreams.forget(connection.url)
			}),
			report: Effect.fn('Connections.report')(function* (id, generation, outcome) {
				yield* Effect.annotateCurrentSpan({outcome: outcome._tag, serverId: id})
				yield* Effect.ignore(
					change(id, generation, () =>
						Match.valueTags(outcome, {
							Discovered: discovered => ({
								error: Option.none(),
								icons: discovered.icons,
								instructions: discovered.instructions,
								tools: Array.length(discovered.tools)
							}),
							Failed: failure => ({error: Option.some(failure.error)})
						})
					),
					{log: 'Warn', message: 'Cannot save the MCP discovery outcome'}
				)
			}),
			usage: period =>
				pipe(
					usageWindow(period, ['connectionCalls'], range =>
						Effect.mapError(listCalls(range), connectionFailure('MCP storage failed'))
					),
					Stream.provideService(Reactivity.Reactivity, reactivity),
					Stream.withSpan('Connections.usage', {attributes: {period, 'rpc.stream': true}})
				),
			// The list is read again after each change and once a minute, so an expired provider shows as expired.
			watch: user =>
				pipe(
					sql.reactive(['connections'], list),
					Stream.merge(
						pipe(
							Stream.tick(Duration.minutes(1)),
							Stream.drop(1),
							Stream.mapEffect(() => list)
						)
					),
					// A slow reader gets only the newest list.
					Stream.buffer({capacity: 1, strategy: 'sliding'}),
					Stream.withSpan('Connections.watch', {attributes: {'rpc.stream': true, userId: user.id}})
				)
		})
	})

	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'connections_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(Connections, Connections.make), Connections.migrations)
}
