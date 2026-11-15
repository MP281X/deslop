import {Effect, Layer, Option, Predicate, Schema, Struct} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter, HttpServerRequest} from 'effect/http'

// Mark the HTTP owner, not just the protocol child: its lifetime includes the open subscription.
export const McpStream = HttpRouter.middleware()(app =>
	Effect.gen(function* () {
		if ((yield* HttpServerRequest.HttpServerRequest).method === 'POST') {
			const subscription = yield* Effect.option(
				HttpServerRequest.schemaBodyJson(Schema.Struct({method: Schema.Literal('subscriptions/listen')}))
			)
			if (Option.isSome(subscription)) yield* Effect.annotateCurrentSpan('rpc.stream', true)
		}
		return yield* app
	})
)

// Gateway's raw upstream registrations deliberately do not use this Toolkit presentation layer.
export const layerStructuredTools = Layer.effect(
	McpServer.McpServer,
	Effect.gen(function* () {
		const registry = yield* McpServer.McpServer
		return McpServer.McpServer.of({
			...registry,
			addTool: Effect.fnUntraced(function* (options) {
				if (options.tool.outputSchema?.['type'] !== 'object') {
					return yield* Effect.die(`Own MCP tool ${options.tool.name} must declare an object success schema`)
				}
				yield* registry.addTool({
					...options,
					handle: input =>
						Effect.map(options.handle(input), result => {
							if (Predicate.hasProperty(result, 'content') && result.isError !== true) {
								return Struct.evolve(result, {content: () => []})
							}
							return result
						})
				})
			})
		})
	})
)
