import {Effect, Layer, Predicate, Struct} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'

// Gateway's raw upstream registrations deliberately do not use this Toolkit presentation layer.
export const layerStructuredTools = Layer.effect(McpServer.McpServer)(
	Effect.gen(function* () {
		const registry = yield* McpServer.McpServer
		return McpServer.McpServer.of({
			...registry,
			addTool: options =>
				Effect.gen(function* () {
					if (options.tool.outputSchema?.['type'] !== 'object') {
						return yield* Effect.die(`Own MCP tool ${options.tool.name} must declare an object success schema`)
					}
					yield* registry.addTool({
						...options,
						handle: input =>
							Effect.map(options.handle(input), result => {
								if (Predicate.hasProperty(result, 'content') && result.isError !== true) {
									return McpSchema.CallToolResult.make({...Struct.omit(result, []), content: []})
								}
								return result
							})
					})
				})
		})
	})
)
