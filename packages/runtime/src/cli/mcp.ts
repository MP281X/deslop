import {NodeStdio} from '@effect/platform-node'

import {Boolean, Cause, Context, Effect, Exit, Fiber, Layer, Logger, pipe} from 'effect'

import {McpClient, McpProtocol, McpSchema, McpServer} from 'effect/ai'
import {HttpClient, HttpClientError, HttpClientRequest} from 'effect/http'

import {oauth} from '#cli/oauth.ts'

function wireError<A, E extends {message: string}, R>(effect: Effect.Effect<A, E, R>) {
	// oxlint-disable-next-line @deslop/coding-standards/preserve-error-cause -- MCP wire errors carry JSON data, not an Error cause.
	return Effect.mapError(effect, cause =>
		McpSchema.InternalError.make({data: {cause: cause.message}, message: cause.message})
	)
}

// The subprocess owns only its protocol connection, never the app's data or background work.
export function attachMcp(name: string, url: string, issuer: string) {
	return pipe(
		Effect.scoped(
			Effect.gen(function* () {
				const base = yield* HttpClient.HttpClient
				const http = yield* Boolean.match(issuer === '', {
					onFalse: () =>
						Effect.map(oauth(name, new URL(url).origin, issuer), session =>
							HttpClient.mapRequestEffect(base, request =>
								pipe(
									session.token,
									Effect.mapBoth({
										// oxlint-disable-next-line @deslop/coding-standards/preserve-error-cause -- HttpClientError preserves the original cause in its nested TransportError reason.
										onFailure: cause =>
											new HttpClientError.HttpClientError({
												reason: new HttpClientError.TransportError({
													cause,
													description: 'CLI authentication failed; sign in again',
													request
												})
											}),
										onSuccess: token => HttpClientRequest.bearerToken(request, token)
									})
								)
							)
						),
					onTrue: () => Effect.succeed(base)
				})
				const transport = yield* Effect.provideService(
					McpClient.http({protocol: McpProtocol.v2026_07_28, url}),
					HttpClient.HttpClient,
					http
				)
				const client = yield* Effect.provideService(
					McpClient.make({name: `${name}-cli`, version: '0.1.0'}),
					McpClient.Transport,
					transport
				)
				const tools = yield* client.listTools()
				const resources = yield* client.listResources()
				const prompts = yield* client.listPrompts()
				const registrations = Layer.effectDiscard(
					Effect.gen(function* () {
						const server = yield* McpServer.McpServer
						for (const tool of tools) {
							yield* server.addTool({
								annotations: Context.empty(),
								handle: Effect.fnUntraced(function* (args) {
									return yield* wireError(client.callTool({arguments: args, tool}))
								}),
								tool
							})
						}
						for (const resource of resources) {
							yield* server.addResource({
								annotations: Context.empty(),
								handle: wireError(client.readResource({uri: resource.uri})),
								resource
							})
						}
						for (const prompt of prompts) {
							yield* server.addPrompt({
								annotations: Context.empty(),
								completions: {},
								handle: Effect.fnUntraced(function* (args) {
									return yield* wireError(client.getPrompt({arguments: args, prompt}))
								}),
								prompt
							})
						}
					})
				)
				return yield* pipe(
					McpServer.layerStdio({
						name,
						protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
						registrations,
						version: client.serverInfo?.version ?? '0.1.0'
					}),
					Layer.provide(NodeStdio.layer),
					Layer.launch,
					// Effect's stdio protocol interrupts its owning fiber on EOF, not on failure.
					Effect.forkScoped,
					Effect.flatMap(Fiber.await),
					Effect.flatMap(
						Exit.match({
							onFailure: cause => {
								if (Cause.hasInterruptsOnly(cause)) return Effect.void
								return Effect.failCause(cause)
							},
							onSuccess: Effect.succeed
						})
					)
				)
			})
		),
		Effect.provideService(Logger.LogToStderr, true)
	)
}
