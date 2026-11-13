import {
	Array,
	Context,
	Duration,
	Effect,
	Exit,
	Function,
	Layer,
	Option,
	RcMap,
	Schema,
	Scope,
	Semaphore,
	pipe
} from 'effect'

import {SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError} from '@modelcontextprotocol/client'
import {McpClient, McpClientError, McpProtocol, McpSchema} from 'effect/ai'
import {FetchHttpClient, Headers, HttpClient, HttpClientRequest} from 'effect/http'

import {AuthError} from '@deslop/runtime/shared/auth'

import {endSession, mcpClient} from '#services/connections/lib/utils.ts'
import {UpstreamError} from '#services/connections/schema.ts'

// The SDK reserves Authorization in per-request headers; its Fetch boundary consumes this private header before sending.
const REQUEST_AUTHORIZATION = 'x-deslop-mcp-authorization'

type Upstream = {
	readonly serverInfo?: McpSchema.Implementation
	readonly instructions?: string
	readonly listTools: () => Effect.Effect<
		readonly McpSchema.Tool[],
		McpClientError.McpClientError | UpstreamError | Schema.SchemaError
	>
	readonly callTool: (
		tool: McpSchema.Tool,
		args: Record<string, unknown>
	) => Effect.Effect<McpSchema.CallToolResult, McpClientError.McpClientError | UpstreamError | Schema.SchemaError>
}

// A rejected session or bearer is safe to establish again; an ambiguous transport failure is never retried.
export function upstreamStatus(error: unknown): number {
	if (Schema.is(UpstreamError)(error)) return upstreamStatus(error.cause)
	if (error instanceof SdkHttpError) return error.status
	if (error instanceof UnauthorizedError) return 401
	if (McpClientError.isMcpClientError(error)) {
		if (error.reason._tag === 'ClosedError' && error.reason.sessionExpired === true) return 404
		if (error.reason._tag === 'HttpError') return error.reason.status
	}
	return 0
}

const accessToken = Context.Reference<Option.Option<string>>('gateway/UpstreamAccess', {defaultValue: Option.none})
const requestHeaders = Effect.map(accessToken, token => ({
	[REQUEST_AUTHORIZATION]: Option.match(token, {onNone: Function.constant(''), onSome: value => `Bearer ${value}`})
}))

function unsupportedProtocol(error: McpClientError.McpClientError) {
	if (error.reason._tag === 'HttpError') {
		return (
			error.reason.status >= 400 &&
			error.reason.status < 500 &&
			error.reason.status !== 401 &&
			error.reason.status !== 403
		)
	}
	return (
		error.reason._tag === 'UnsupportedError' ||
		(error.reason._tag === 'ProtocolError' &&
			(error.reason.code === -32_601 || error.reason.code === McpSchema.UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE))
	)
}

export class Upstreams extends Context.Service<Upstreams>()('@deslop/gateway/services/upstreams/service/Upstreams', {
	make: Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient
		const fetch = yield* FetchHttpClient.Fetch
		// Locks are resources, not an evictable cache: an active server can never acquire a second lock.
		const locks = yield* RcMap.make({lookup: (_url: string) => Semaphore.make(1)})
		const sessions = yield* RcMap.make({
			idleTimeToLive: Duration.infinity,
			lookup: Effect.fnUntraced(function* (url: string) {
				const token = yield* accessToken
				const client = HttpClient.mapRequestEffect(http, request =>
					Effect.map(accessToken, access =>
						Option.match(access, {
							onNone: () => request,
							onSome: value => HttpClientRequest.bearerToken(request, value)
						})
					)
				)
				const connect = Effect.fnUntraced(function* (protocol: McpProtocol.ProtocolAdapter<McpClient.ProtocolVersion>) {
					const nativeScope = yield* Scope.make()
					yield* Effect.addFinalizer(exit => Scope.close(nativeScope, exit))
					return yield* pipe(
						McpClient.make({name: 'Deslop MCP gateway', version: '0.1.0'}),
						Effect.provideServiceEffect(McpClient.Transport, McpClient.http({protocol, url})),
						Effect.provideService(HttpClient.HttpClient, client),
						Effect.provideService(Scope.Scope, nativeScope),
						Effect.tapError(() => Scope.close(nativeScope, Exit.void))
					)
				})
				const upstream = yield* pipe(
					connect(McpProtocol.v2026_07_28),
					Effect.catchIf(unsupportedProtocol, () => connect(McpProtocol.v2025_11_25)),
					Effect.map(value => ({
						callTool: (tool: McpSchema.Tool, args: Record<string, unknown>) => value.callTool({arguments: args, tool}),
						instructions: value.instructions,
						listTools: () => value.listTools(),
						serverInfo: value.serverInfo
					})),
					// Effect supports only 2025-11-25 and 2026-07-28. A server choosing another revision needs SDK negotiation.
					Effect.catchIf(unsupportedProtocol, () =>
						Effect.gen(function* () {
							const transport = new StreamableHTTPClientTransport(new URL(url), {
								fetch: (input, init) => {
									const headers = Headers.fromInput(init?.headers)
									return fetch(input, {
										...init,
										headers: Option.match(Option.fromUndefinedOr(headers[REQUEST_AUTHORIZATION]), {
											onNone: () => headers,
											onSome: bearer => {
												const outgoing = Headers.remove(headers, REQUEST_AUTHORIZATION)
												if (bearer === '') return Headers.remove(outgoing, 'authorization')
												return Headers.set(outgoing, 'authorization', bearer)
											}
										})
									})
								},
								requestInit: {
									headers: Option.match(token, {
										onNone: () => ({}),
										onSome: value => ({authorization: `Bearer ${value}`})
									}),
									redirect: 'error'
								}
							})
							const sdk = yield* Effect.acquireRelease(Effect.sync(mcpClient), acquired =>
								endSession(
									transport,
									acquired,
									cause => AuthError.make({cause, message: 'MCP session ended'}),
									'upstream'
								)
							)
							yield* Effect.tryPromise({
								catch: cause => UpstreamError.make({cause}),
								try: signal => sdk.connect(transport, {signal})
							})
							return {
								callTool: Effect.fnUntraced(function* (tool: McpSchema.Tool, args: Record<string, unknown>) {
									const headers = yield* requestHeaders
									return yield* Schema.decodeEffect(McpSchema.CallToolResult)(
										yield* Effect.tryPromise({
											catch: cause => UpstreamError.make({cause}),
											try: signal => sdk.callTool({arguments: args, name: tool.name}, {headers, signal})
										})
									)
								}),
								instructions: sdk.getInstructions(),
								listTools: Effect.fnUntraced(function* () {
									const headers = yield* requestHeaders
									const result = yield* Effect.tryPromise({
										catch: cause => UpstreamError.make({cause}),
										try: signal => sdk.listTools(undefined, {headers, signal})
									})
									return yield* Schema.decodeUnknownEffect(Schema.Array(McpSchema.Tool))(
										Array.filter(result.tools, tool => tool.execution?.taskSupport !== 'required')
									)
								}),
								serverInfo: sdk.getServerVersion()
							}
						})
					)
				)
				return upstream satisfies Upstream
			})
		})
		return {
			forget: Effect.fn('Upstreams.forget')(function* (url: string) {
				yield* Semaphore.withPermit(yield* RcMap.get(locks, url), RcMap.invalidate(sessions, url))
			}, Effect.scoped),
			use: Effect.fn('Upstreams.use')(function* <A, E>(
				url: string,
				authorize: Effect.Effect<Option.Option<string>, AuthError>,
				run: (upstream: Upstream) => Effect.Effect<A, E>
			) {
				const lock = yield* RcMap.get(locks, url)
				const execute = Effect.gen(function* () {
					// Removal, replacement and expiry are checked again before a rejected session is reopened.
					const token = yield* authorize
					const session = yield* pipe(
						RcMap.get(sessions, url),
						// Failed acquisitions leave no entry before unlocking.
						Effect.tapError(() => RcMap.invalidate(sessions, url)),
						Effect.provideService(accessToken, token),
						Semaphore.withPermit(lock)
					)
					return yield* pipe(
						run(session),
						Effect.provideService(accessToken, token),
						Effect.tapError(() =>
							Semaphore.withPermit(
								lock,
								Effect.gen(function* () {
									// A delayed failure from an old session must not invalidate a newer one.
									if (Option.exists(yield* RcMap.getOption(sessions, url), value => value === session)) {
										yield* RcMap.invalidate(sessions, url)
									}
								})
							)
						)
					)
				})
				return yield* Effect.catchIf(
					execute,
					error => upstreamStatus(error) === 404,
					() => execute
				)
			}, Effect.scoped)
		}
	})
}) {
	static readonly layer = Layer.effect(Upstreams, Upstreams.make)
}
