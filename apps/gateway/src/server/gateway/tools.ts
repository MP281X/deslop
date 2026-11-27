import {Array, Effect, Function, Layer, Option, Schema, Struct, pipe} from 'effect'

import {McpServer, Tool, Toolkit} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerMcp} from '@deslop/runtime/server/http'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProvider, ConnectionStatus, FailureReason, ServerId} from '#contracts'

import {AiProxy} from '#server/ai-proxy/service.ts'
import {Connections} from '#server/connections/service.ts'
import {GatewayDiscovery} from '#server/gateway/http.ts'
import {Gateway} from '#server/gateway/service.ts'

const ToolContracts = Toolkit.make(
	Tool.make('list_mcp_connections', {
		description:
			"Use when an MCP tool is missing or failing, or to see each server's state; returns each server's id, status, tool count and error, and one server's own instructions when named.",
		failure: AuthError,
		parameters: Schema.Struct({
			server: Schema.OptionFromOptionalKey(
				ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
			)
		}),
		success: Schema.Struct({
			servers: Schema.Array(
				Schema.Struct({
					error: Schema.OptionFromOptionalKey(FailureReason),
					id: ServerId,
					instructions: Schema.OptionFromOptionalKey(Schema.String),
					status: ConnectionStatus,
					tools: Schema.Int
				})
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_mcp_server', {
		dependencies: [CurrentUser],
		description:
			'Use when the user asks to remove a shared MCP server; removes it by the id list_mcp_connections returns.',
		failure: AuthError,
		parameters: Schema.Struct({
			server: ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
		}),
		success: Schema.Struct({server: ServerId})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_ai_key', {
		dependencies: [CurrentUser],
		description:
			'Use when the user asks to remove their OpenCode, Anthropic or OpenAI credential; stops their calls using that key.',
		failure: AuthError,
		parameters: Schema.Struct({provider: AiProvider}),
		success: Schema.Struct({provider: AiProvider})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)

const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const ai = yield* AiProxy
		const connections = yield* Connections
		const gateway = yield* Gateway
		return ToolContracts.of({
			list_mcp_connections: Effect.fnUntraced(function* (input) {
				const all = yield* connections.definitions
				yield* pipe(
					input.server,
					Option.filter(id => !Array.some(all, server => server.id === id)),
					Option.match({
						onNone: () => Effect.void,
						onSome: id =>
							AuthError.make({
								message: `Unknown server ${id}; valid servers: ${pipe(
									all,
									Array.map(server => server.id),
									Array.join(', ')
								)}. Nothing changed.`
							})
					})
				)
				return {
					servers: pipe(
						all,
						Array.filter(server =>
							Option.match(input.server, {onNone: Function.constTrue, onSome: id => server.id === id})
						),
						Array.map(server => ({
							error: server.error,
							instructions: Option.filter(server.instructions, () => Option.contains(input.server, server.id)),
							...Struct.pick(server, ['id', 'status', 'tools'])
						}))
					)
				}
			}),
			remove_ai_key: Effect.fnUntraced(function* (input) {
				yield* ai.removeKey((yield* CurrentUser).id, input.provider)
				return {provider: input.provider}
			}),
			remove_mcp_server: Effect.fnUntraced(function* (input) {
				yield* connections.remove(
					input.server,
					yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage MCP servers')
				)
				yield* gateway.removed
				return {server: input.server}
			})
		})
	})
)

export const GatewayMcp = pipe(
	layerMcp({
		contracts: ToolContracts,
		instructions:
			'Tools use <server>__<tool>. Use list_mcp_connections for missing or failing tools; name a server to read its full instructions.',
		registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
	}),
	Layer.provide(GatewayDiscovery.layer),
	Layer.provide(McpServer.McpServer.layer)
)
