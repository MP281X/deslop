import {
	Array,
	Cache,
	DateTime,
	Duration,
	Context,
	Function,
	Effect,
	HashMap,
	Layer,
	Match,
	Option,
	RcMap,
	Redacted,
	Ref,
	Schema,
	Semaphore,
	Struct,
	pipe
} from 'effect'

import {
	discoverAuthorizationServerMetadata,
	startAuthorization,
	validateAuthorizationResponseIssuer
} from '@modelcontextprotocol/client'
import {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import type {Admin, UserId} from '@deslop/runtime/shared/auth'
import {AuthError} from '@deslop/runtime/shared/auth'

import type {Callback, ConnectionAddress, ConnectionIssuer, TokenExchange} from './contract.ts'
import {
	ConnectionGrant,
	ConnectionOAuthState,
	OAuthClient,
	Registration,
	ServerMetadata,
	Token,
	connectable
} from './contract.ts'

import type {ConnectionGeneration, ConnectionState, ServerId} from '#connections/contract.ts'
import {UpstreamError, failureMessage} from '#connections/contract.ts'
import {connectionFailure, describe} from '#connections/failure.ts'
import {clientMetadata} from '#connections/metadata.ts'
import {Connections, gatewayUrl} from '#connections/server.ts'

// A provider sign-in in progress, for ten minutes and in memory: a restart asks to connect again.
type Pending = {
	client: OAuthClient
	generation: ConnectionGeneration
	id: ServerId
	metadata: ServerMetadata
	userId: UserId
	verifier: string
}

// The provider's current capabilities, which must include S256 PKCE.
const currentMetadata = Effect.fnUntraced(function* (
	fetch: Context.Service.Shape<typeof FetchHttpClient.Fetch>,
	issuer: string
) {
	const metadata = yield* Schema.decodeUnknownEffect(ServerMetadata)(
		yield* Effect.tryPromise({
			catch: cause => UpstreamError.make({cause}),
			try: signal =>
				discoverAuthorizationServerMetadata(issuer, {
					fetchFn: (target, init) =>
						fetch(target, {
							...init,
							signal: AbortSignal.any([signal, ...Option.toArray(Option.fromNullishOr(init?.signal))])
						})
				})
		})
	)
	if (!Option.exists(metadata.code_challenge_methods_supported, methods => Array.contains(methods, 'S256'))) {
		return yield* AuthError.make({message: 'The provider must advertise S256 PKCE and safe authorization endpoints.'})
	}
	return metadata
})

const startFlow = Effect.fnUntraced(function* (
	metadata: ServerMetadata,
	request: {
		readonly clientId: string
		readonly redirectUrl: string
		readonly resource: string
		readonly scope: string
		readonly state: ConnectionOAuthState
	}
) {
	const encodedMetadata = yield* Schema.encodeEffect(ServerMetadata)(metadata)
	return yield* Effect.tryPromise({
		catch: cause => UpstreamError.make({cause}),
		try: () =>
			startAuthorization(metadata.issuer, {
				clientInformation: {client_id: request.clientId},
				metadata: {
					...encodedMetadata,
					code_challenge_methods_supported: [...(encodedMetadata.code_challenge_methods_supported ?? [])],
					response_types_supported: [...(encodedMetadata.response_types_supported ?? [])]
				},
				redirectUrl: request.redirectUrl,
				resource: request.resource,
				scope: request.scope,
				state: request.state
			})
	})
})

export class Grants extends Context.Service<
	Grants,
	{
		readonly begin: (
			id: ServerId,
			user: Admin
		) => Effect.Effect<{state: Option.Option<ConnectionOAuthState>; url: string}, AuthError>
		// `route` is the server id a registered client's callback carries; the metadata document's callback carries none.
		readonly complete: (params: Callback, route: Option.Option<ServerId>, user: Admin) => Effect.Effect<void, AuthError>
		readonly token: (
			id: ServerId,
			generation: ConnectionGeneration,
			rejectedToken: Option.Option<string>
		) => Effect.Effect<string, AuthError>
	}
>()('@deslop/gateway/grants/server/Grants') {
	static readonly make = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const connections = yield* Connections
		const origin = yield* gatewayUrl
		const callback = `${origin}/oauth/callback`
		const clientInfo = clientMetadata(origin)
		function clientIdOf(client: OAuthClient) {
			return Match.valueTags(client, {Document: () => clientInfo.client_id, Registered: found => found.clientId})
		}
		const findGrant = SqlSchema.findOneOption({
			Request: ConnectionGrant.fields.serverId,
			Result: ConnectionGrant,
			execute: id => sql`SELECT * FROM ${sql(ConnectionGrant.table)} WHERE serverId = ${id}`
		})
		// A grant whose refresh token the provider refused shows Expired until it is connected again; a token another call already renewed is left alone.
		const endGrant = SqlSchema.void({
			Request: Schema.Struct({refreshToken: Schema.String, serverId: ConnectionGrant.fields.serverId}),
			execute: request => sql`
				UPDATE ${sql(ConnectionGrant.table)} SET expiresAt = 0, refreshToken = NULL
				WHERE serverId = ${request.serverId} AND refreshToken = ${request.refreshToken}
			`
		})
		const asStorageAuthError = Effect.mapError(connectionFailure('MCP storage failed'))

		// Each server's token is read and refreshed one call at a time, so concurrent calls never spend its refresh token twice.
		const locks = yield* RcMap.make({lookup: (_id: ServerId) => Semaphore.make(1)})
		const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const fetch = yield* FetchHttpClient.Fetch
		const random = yield* SecureRandom.SecureRandom
		const pending = yield* Cache.make<ConnectionOAuthState, Pending, AuthError>({
			capacity: 64,
			lookup: () => Effect.fail(AuthError.make({message: 'The connection expired; connect it again'})),
			timeToLive: Duration.minutes(10)
		})
		const callbacks = yield* Semaphore.make(1)
		// Each server's newest sign-in: an older one finishing later would overwrite the authorization the admin chose last.
		const newest = yield* Ref.make(HashMap.empty<ServerId, ConnectionOAuthState>())
		const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)

		const exchange = Effect.fnUntraced(function* (
			connection: ConnectionAddress,
			issued: ConnectionIssuer,
			params: TokenExchange
		) {
			// The refresh token this exchange spends, if it renews a grant.
			const spent = pipe(
				Match.value(params),
				Match.when({grant_type: 'refresh_token'}, request => Option.some(request.refresh_token)),
				Match.orElse(() => Option.none())
			)
			const token = yield* pipe(
				HttpClientRequest.post(issued.tokenEndpoint),
				HttpClientRequest.bodyUrlParams({...params, client_id: issued.clientId, resource: connection.url}),
				http.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
				Effect.tapErrorTag('HttpClientError', cause => {
					// Only 400 and 401 reject the grant itself; a rate limit or a timeout leaves it to the next try.
					if (
						!(cause.reason instanceof HttpClientError.StatusCodeError) ||
						!Array.contains([400, 401], cause.reason.response.status)
					) {
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
				Effect.timeout(Duration.seconds(20))
			)
			yield* connections.authorize(connection.generation, {
				accessToken: token.access_token,
				clientId: issued.clientId,
				expiresAt: DateTime.addDuration(
					yield* DateTime.now,
					Option.getOrElse(token.expires_in, () => Duration.hours(1))
				),
				// A refresh answer may leave the refresh token out, which keeps the one it spent.
				refreshToken: Option.orElse(token.refresh_token, () => Option.map(spent, Redacted.make)),
				serverId: connection.id,
				tokenEndpoint: issued.tokenEndpoint
			})
			return Redacted.value(token.access_token)
		})

		// A connection step that fails or outlasts its limit leaves its reason on the connection.
		function settle(connection: ConnectionState, limit: Duration.Duration) {
			return <A, E, R>(step: Effect.Effect<A, E, R>) =>
				pipe(
					step,
					Effect.timeout(limit),
					// Only the fixed reason reaches the log: a provider's own text can carry a body or a token.
					Effect.tapError(cause =>
						Effect.logWarning(`The MCP connection could not be completed: ${failureMessage(describe(cause))}`)
					),
					Effect.catch(
						Effect.fnUntraced(function* (cause) {
							const reason = describe(cause)
							yield* connections.change(connection.id, connection.generation, () => ({error: Option.some(reason)}))
							return yield* connectionFailure(connection.name)(cause)
						})
					)
				)
		}

		return Grants.of({
			begin: Effect.fn('Grants.begin')(
				function* (id: ServerId, user: Admin) {
					const connection = yield* connections.get(id)
					return yield* Option.match(Option.all({issuer: connection.issuer, scope: connection.scope}), {
						onNone: Effect.fnUntraced(function* () {
							yield* connections.change(id, connection.generation, () => ({error: Option.none()}))
							return {state: Option.none<ConnectionOAuthState>(), url: '/'}
						}),
						onSome: Effect.fnUntraced(function* (oauth) {
							return yield* pipe(
								Effect.gen(function* () {
									// Check the provider's current capabilities before authorization.
									const metadata = yield* currentMetadata(fetch, oauth.issuer)
									// Each connection registers anew, so a client registered for an earlier callback is never reused; the server keeps its grant until the new client has tokens.
									const registered = yield* Option.match(metadata.registration_endpoint, {
										onNone: Effect.fnUntraced(function* () {
											yield* connectable(metadata)
											return OAuthClient.cases.Document.make({})
										}),
										onSome: Effect.fnUntraced(function* (endpoint) {
											return yield* pipe(
												HttpClientRequest.bodyJson(HttpClientRequest.post(endpoint), {
													...Struct.omit(clientInfo, ['client_id']),
													redirect_uris: [`${callback}/${id}`]
												}),
												Effect.flatMap(request => http.execute(request)),
												Effect.flatMap(HttpClientResponse.schemaBodyJson(Registration)),
												Effect.map(found => OAuthClient.cases.Registered.make({clientId: found.client_id}))
											)
										})
									})
									const stateId = ConnectionOAuthState.make(yield* nonce)
									yield* Ref.update(newest, HashMap.set(id, stateId))
									const authorization = yield* startFlow(metadata, {
										clientId: clientIdOf(registered),
										redirectUrl: Match.valueTags(registered, {
											Document: () => callback,
											Registered: () => `${callback}/${id}`
										}),
										resource: connection.url,
										scope: oauth.scope,
										state: stateId
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
								settle(connection, Duration.seconds(20))
							)
						})
					})
				},
				Effect.mapError(connectionFailure('Cannot connect this MCP'))
			),
			complete: Effect.fn('Grants.complete')(
				function* (params: Callback, route: Option.Option<ServerId>, user: Admin) {
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
					const connection = yield* connections.get(flow.id)
					if (
						flow.userId !== user.id ||
						flow.generation !== connection.generation ||
						connection.mode !== 'oauth' ||
						!pipe(yield* Ref.get(newest), HashMap.get(flow.id), Option.contains(params.state))
					) {
						return yield* AuthError.make({message: 'The connection expired; connect it again'})
					}
					yield* pipe(
						Effect.gen(function* () {
							const code = yield* pipe(
								params.code,
								Option.filter(() => Option.isNone(params.error)),
								Option.match({
									onNone: () =>
										AuthError.make({
											message: `The provider declined the connection (${Option.getOrElse(params.error, Function.constant('no code'))})`
										}),
									onSome: Effect.succeed
								})
							)
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
										iss: Option.getOrUndefined(params.iss),
										issParameterSupported:
											OAuthClient.isAnyOf(['Document'])(flow.client) ||
											Option.contains(flow.metadata.authorization_response_iss_parameter_supported, true)
									})
							})
							// Under the server's token lock, so a refresh already in flight cannot land after these new tokens.
							yield* Semaphore.withPermit(
								yield* RcMap.get(locks, connection.id),
								exchange(
									connection,
									{clientId: clientIdOf(flow.client), tokenEndpoint: flow.metadata.token_endpoint},
									{
										code,
										code_verifier: flow.verifier,
										grant_type: 'authorization_code',
										redirect_uri: Match.valueTags(flow.client, {
											Document: () => callback,
											Registered: () => `${callback}/${connection.id}`
										})
									}
								)
							)
						}),
						Effect.scoped,
						settle(connection, Duration.seconds(30))
					)
				},
				Effect.mapError(connectionFailure('Cannot finish the connection'))
			),
			token: Effect.fn('Grants.token')(
				function* (id: ServerId, generation: ConnectionGeneration, rejectedToken: Option.Option<string>) {
					// The grant is read under its server's lock, so a call that waited sees the token the one before it saved.
					return yield* Semaphore.withPermit(
						yield* RcMap.get(locks, id),
						Effect.timeout(
							Effect.gen(function* () {
								const connection = yield* connections.get(id)
								if (connection.generation !== generation) {
									return yield* AuthError.make({message: 'This MCP connection was replaced.'})
								}
								const now = yield* DateTime.now
								return yield* Option.match(yield* asStorageAuthError(findGrant(id)), {
									onNone: () => Effect.fail(AuthError.make({message: `Connect ${connection.name} on ${origin}`})),
									onSome: grant => {
										// A token that can be refreshed is renewed 30 seconds early; one that cannot is used to its end.
										const margin = Option.match(grant.refreshToken, {
											onNone: () => Duration.zero,
											onSome: () => Duration.seconds(30)
										})
										const access = Redacted.value(grant.accessToken)
										if (
											!Option.contains(rejectedToken, access) &&
											DateTime.isGreaterThan(grant.expiresAt, DateTime.addDuration(now, margin))
										) {
											return Effect.succeed(access)
										}
										return Option.match(grant.refreshToken, {
											onNone: () =>
												Effect.fail(
													AuthError.make({message: `Reconnect ${connection.name}; its authorization expired`})
												),
											onSome: refresh =>
												exchange(connection, grant, {
													grant_type: 'refresh_token',
													refresh_token: Redacted.value(refresh)
												})
										})
									}
								})
							}),
							Duration.seconds(20)
						)
					)
				},
				Effect.scoped,
				Effect.mapError(connectionFailure('Cannot refresh this MCP; reconnect it from the MCP page'))
			)
		})
	})

	static readonly layer = Layer.effect(Grants, Grants.make)
}
