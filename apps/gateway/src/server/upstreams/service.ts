import {
	Array,
	ByteSize,
	Context,
	Duration,
	Effect,
	Exit,
	HashMap,
	Layer,
	Option,
	RcMap,
	Ref,
	Schema,
	Scope,
	Semaphore,
	pipe
} from 'effect'

import {Client, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError} from '@modelcontextprotocol/client'
import type {Tool} from '@modelcontextprotocol/client'
import {McpClient, McpClientError, McpProtocol, McpSchema} from 'effect/ai'
import {FetchHttpClient, Headers, HttpClient, HttpClientRequest} from 'effect/http'

import type {AuthError} from '@deslop/runtime/shared/auth'

import {describe} from '#server/connections/failure.ts'
import {UpstreamError, UpstreamExchangeError} from '#server/connections/schema.ts'

// The SDK reserves Authorization in per-request headers; its Fetch boundary consumes this private header before sending.
const REQUEST_AUTHORIZATION = 'x-deslop-mcp-authorization'
// An action still running after this is reported as possibly committed, never retried.
const ACTION_DEADLINE = Duration.minutes(5)

type Upstream = {
	readonly serverInfo: Option.Option<McpSchema.Implementation>
	readonly instructions: Option.Option<string>
	readonly listTools: () => Effect.Effect<
		readonly McpSchema.Tool[],
		McpClientError.McpClientError | UpstreamError | Schema.SchemaError
	>
	readonly callTool: (
		tool: McpSchema.Tool,
		args: Record<string, unknown>
	) => Effect.Effect<McpSchema.CallToolResult, McpClientError.McpClientError | UpstreamError | Schema.SchemaError>
	// The server no longer knows this session: it answered without running the request.
	readonly expired: (error: unknown) => boolean
}

function causeOf(error: unknown) {
	if (Schema.is(UpstreamError)(error)) return error.cause
	return error
}

// The bearer was refused before the request ran.
function refused(error: unknown) {
	const cause = causeOf(error)
	if (cause instanceof SdkHttpError) return cause.status === 401
	if (cause instanceof UnauthorizedError) return true
	return (
		McpClientError.isMcpClientError(cause) &&
		Schema.is(McpClientError.HttpError)(cause.reason) &&
		cause.reason.status === 401
	)
}

function failureOf(error: unknown, expired: boolean) {
	return UpstreamExchangeError.make({expired, reason: describe(error), unauthorized: refused(error)})
}

const accessHeaders = Context.Reference<Headers.Headers>('gateway/UpstreamAccess', {defaultValue: () => Headers.empty})
const requestHeaders = Effect.map(accessHeaders, headers =>
	pipe(headers, Headers.remove('authorization'), Headers.set(REQUEST_AUTHORIZATION, headers['authorization'] ?? ''))
)

function unsupportedProtocol(error: McpClientError.McpClientError) {
	if (Schema.is(McpClientError.HttpError)(error.reason)) {
		// Older servers can reject the offered revision with a generic client error before negotiation.
		return (
			error.reason.status >= 400 &&
			error.reason.status < 500 &&
			error.reason.status !== 401 &&
			error.reason.status !== 403
		)
	}
	return (
		Schema.is(McpClientError.UnsupportedError)(error.reason) ||
		(Schema.is(McpClientError.ProtocolError)(error.reason) &&
			(error.reason.code === -32_601 || error.reason.code === McpSchema.UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE))
	)
}

export class Upstreams extends Context.Service<Upstreams>()('@deslop/gateway/server/upstreams/service/Upstreams', {
	make: Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient
		const fetch = yield* FetchHttpClient.Fetch
		// Locks are resources, not an evictable cache: an active server can never acquire a second lock.
		const locks = yield* RcMap.make({lookup: (_url: string) => Semaphore.make(1)})
		// How many requests one upstream runs at once; the rest wait their turn inside the deadline.
		const slots = yield* RcMap.make({lookup: (_url: string) => Semaphore.make(8)})
		// Discovery and actions must use the same negotiated upstream capabilities; a session nobody used for an hour ends, so one a failed add opened cannot stay forever.
		const sessions = yield* RcMap.make({
			idleTimeToLive: Duration.hours(1),
			lookup: Effect.fnUntraced(function* (url: string) {
				const initialHeaders = yield* accessHeaders
				const client = HttpClient.mapRequestEffect(http, request =>
					Effect.map(accessHeaders, access => HttpClientRequest.setHeaders(request, access))
				)
				const connect = Effect.fnUntraced(function* (protocol: McpProtocol.ProtocolAdapter<McpClient.ProtocolVersion>) {
					const nativeScope = yield* Scope.make()
					yield* Effect.addFinalizer(exit => Scope.close(nativeScope, exit))
					return yield* pipe(
						// A catalogue past these bounds is refused rather than held in memory.
						McpClient.make({
							discoveryLimits: {maxItems: 1000, maxPages: 20},
							name: 'Deslop MCP gateway',
							version: '0.1.0'
						}),
						Effect.provideServiceEffect(
							McpClient.Transport,
							McpClient.http({maxMessageBytes: ByteSize.mebibytes(4), protocol, url})
						),
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
						expired: (error: unknown) =>
							McpClientError.isMcpClientError(error) &&
							Schema.is(McpClientError.ClosedError)(error.reason) &&
							error.reason.sessionExpired === true,
						instructions: Option.fromUndefinedOr(value.instructions),
						listTools: () => value.listTools(),
						serverInfo: Option.fromUndefinedOr(value.serverInfo)
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
								requestInit: {headers: initialHeaders, redirect: 'error'}
							})
							const sdk = yield* Effect.acquireRelease(
								Effect.sync(
									() => new Client({name: 'Deslop MCP gateway', version: '0.1.0'}, {versionNegotiation: {mode: 'auto'}})
								),
								// A finished session says goodbye within a bound before closing.
								acquired =>
									pipe(
										Effect.tryPromise({catch: describe, try: () => transport.terminateSession()}),
										Effect.timeout(Duration.seconds(3)),
										Effect.ignore({log: 'Warn', message: 'Cannot terminate the upstream MCP session'}),
										Effect.andThen(Effect.tryPromise({catch: describe, try: () => acquired.close()})),
										Effect.ignore({log: 'Warn', message: 'Cannot close the upstream MCP client'})
									)
							)
							// The descriptors this session listed: a call that names its own never makes the SDK send it twice after a header mismatch.
							const descriptors = yield* Ref.make(HashMap.empty<string, Tool>())
							const list = Effect.fnUntraced(function* () {
								const headers = yield* requestHeaders
								const result = yield* Effect.tryPromise({
									catch: cause => UpstreamError.make({cause}),
									try: signal => sdk.listTools(undefined, {headers, signal})
								})
								yield* Ref.set(
									descriptors,
									HashMap.fromIterable(Array.map(result.tools, tool => [tool.name, tool] as const))
								)
								return result.tools
							})
							yield* Effect.tryPromise({
								catch: cause => UpstreamError.make({cause}),
								try: signal => sdk.connect(transport, {signal})
							})
							return {
								callTool: Effect.fnUntraced(function* (tool: McpSchema.Tool, args: Record<string, unknown>) {
									if (!HashMap.has(yield* Ref.get(descriptors), tool.name)) yield* list()
									const known = HashMap.get(yield* Ref.get(descriptors), tool.name)
									const headers = yield* requestHeaders
									return yield* Schema.decodeUnknownEffect(McpSchema.CallToolResult)(
										yield* Effect.tryPromise({
											catch: cause => UpstreamError.make({cause}),
											try: signal =>
												sdk.callTool(
													{arguments: args, name: tool.name},
													{
														headers,
														signal,
														timeout: Duration.toMillis(ACTION_DEADLINE),
														...Option.match(known, {onNone: () => ({}), onSome: toolDefinition => ({toolDefinition})})
													}
												)
										})
									)
								}),
								// A session server answers 404 to an id it no longer knows.
								expired: (error: unknown) => {
									const cause = causeOf(error)
									return cause instanceof SdkHttpError && cause.status === 404 && transport.sessionId !== undefined
								},
								instructions: Option.fromUndefinedOr(sdk.getInstructions()),
								listTools: Effect.fnUntraced(function* () {
									return yield* Schema.decodeUnknownEffect(Schema.Array(McpSchema.Tool))(
										Array.filter(yield* list(), tool => tool.execution?.taskSupport !== 'required')
									)
								}),
								serverInfo: yield* Option.match(Option.fromUndefinedOr(sdk.getServerVersion()), {
									onNone: () => Effect.succeedNone,
									onSome: server => Effect.asSome(Schema.decodeUnknownEffect(McpSchema.Implementation)(server))
								})
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
			use: Effect.fn('Upstreams.use')(function* <A>(
				authorize: Effect.Effect<{headers: Headers.Headers; url: string}, AuthError>,
				run: (
					upstream: Upstream
				) => Effect.Effect<A, McpClientError.McpClientError | UpstreamError | Schema.SchemaError>,
				// Replaces a refused bearer before the one retry a 401 earns; without it, a 401 is final.
				renew: Option.Option<Effect.Effect<void, AuthError>>
			) {
				const execute = Effect.gen(function* () {
					// Removal, replacement and expiry are checked again before a rejected session is reopened.
					const access = yield* authorize
					const lock = yield* RcMap.get(locks, access.url)
					const session = yield* pipe(
						RcMap.get(sessions, access.url),
						// Failed acquisitions leave no entry before unlocking.
						Effect.tapError(() => RcMap.invalidate(sessions, access.url)),
						Effect.provideService(accessHeaders, access.headers),
						Semaphore.withPermit(lock),
						Effect.mapError(error => failureOf(error, false))
					)
					// A slow upstream action must not hold up discovery or another action.
					return yield* pipe(
						run(session),
						Semaphore.withPermit(yield* RcMap.get(slots, access.url)),
						Effect.timeout(ACTION_DEADLINE),
						Effect.provideService(accessHeaders, access.headers),
						Effect.mapError(error => failureOf(error, session.expired(error))),
						Effect.tapError(failure => {
							if (!failure.expired && !failure.unauthorized) return Effect.void
							return Semaphore.withPermit(
								lock,
								Effect.gen(function* () {
									// A delayed failure from an old session must not invalidate a newer one.
									if (Option.exists(yield* RcMap.getOption(sessions, access.url), value => value === session)) {
										yield* RcMap.invalidate(sessions, access.url)
									}
								})
							)
						})
					)
				})
				// Only these two answers prove the request never ran, so either earns exactly one more try.
				return yield* Effect.catchTag(execute, 'UpstreamExchangeError', failure => {
					if (failure.expired) return execute
					return pipe(
						renew,
						Option.filter(() => failure.unauthorized),
						Option.map(replace => Effect.andThen(replace, execute)),
						Option.getOrElse(() => Effect.fail(failure))
					)
				})
			}, Effect.scoped)
		}
	})
}) {
	static readonly layer = Layer.effect(Upstreams, Upstreams.make)
}
