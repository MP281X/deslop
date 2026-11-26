import {Effect, Option, Result, Schema} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {failureOptions} from '@deslop/runtime/shared/auth'
import {MCP_PATH} from '@deslop/runtime/shared/schema'

import {Connections} from '#server/connections/service.ts'
import {ToolRequest} from '#server/gateway/schema.ts'
import {Gateway, listingConnections} from '#server/gateway/service.ts'

// Discovery runs before MCP's registry lookup, after bearer verification; calls await only their server.
export const GatewayDiscovery = HttpRouter.middleware()(
	Effect.gen(function* () {
		const gateway = yield* Gateway
		const auth = yield* Auth
		const connections = yield* Connections
		// A tool call the gateway cannot route answers as a failed tool result, which MCP clients show to the agent.
		const callTool = Effect.fnUntraced(function* (
			call: Extract<ToolRequest, {method: 'tools/call'}>,
			headers: HttpServerRequest.HttpServerRequest['headers']
		) {
			const resolved = yield* Effect.result(
				gateway.resolve(call.params.name, headers, Effect.isSuccess(auth.user(headers)))
			)
			if (Result.isSuccess(resolved)) return Option.none()
			return Option.some(
				HttpServerResponse.jsonUnsafe({
					id: call.id,
					jsonrpc: '2.0',
					result: {content: [{text: resolved.failure.message, type: 'text'}], isError: true}
				})
			)
		})
		return app =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.method !== 'POST' || request.url !== MCP_PATH || request.headers['origin'] !== undefined) {
					return yield* app
				}
				const body = yield* Effect.result(request.json)
				if (Result.isFailure(body) || !Schema.is(ToolRequest)(body.success)) return yield* app
				if (body.success.method === 'tools/call') {
					return yield* Option.match(yield* callTool(body.success, request.headers), {
						onNone: () => app,
						onSome: Effect.succeed
					})
				}
				const verified = yield* Effect.result(auth.user(request.headers))
				if (Result.isFailure(verified)) {
					return HttpServerResponse.jsonUnsafe({error: verified.failure.message}, failureOptions(verified.failure, 401))
				}
				yield* gateway.first(request.headers)
				// A storage outage remains a failed listing rather than an apparently empty registry.
				const snapshot = yield* Effect.result(connections.definitions)
				if (Result.isFailure(snapshot)) {
					return HttpServerResponse.jsonUnsafe({error: snapshot.failure.message}, {status: 503})
				}
				const response = yield* Effect.provideService(app, listingConnections, Effect.succeed(snapshot.success))
				yield* gateway.refresh(request.headers)
				return response
			})
	})
)
