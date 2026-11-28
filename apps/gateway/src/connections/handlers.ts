import {Array, Effect, Function, Option, Schema, Stream, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, CurrentAdmin, CurrentUser} from '@deslop/runtime/shared/auth'

import {ConnectionsRpcs, ConnectionStatus, FailureReason, ServerId} from './contract.ts'
import {Connections} from './server.ts'

import {Gateway} from '#gateway/server.ts'

export const connectionsTools = Toolkit.make(
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
		.annotate(Tool.Strict, true)
)

export const connectionsToolHandlers = connectionsTools.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const gateway = yield* Gateway
		return connectionsTools.of({
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

export const connectionsHandlers = ConnectionsRpcs.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const gateway = yield* Gateway
		return ConnectionsRpcs.of({
			'connections.add': Effect.fnUntraced(function* (input, options) {
				const added = yield* connections.add(input.url, yield* CurrentAdmin, options.headers)
				// A new server's tools are read now, so its first list is not empty.
				yield* gateway.connected(options.headers)
				return added
			}),
			'connections.usage': period => Stream.unwrap(Effect.map(CurrentAdmin, admin => connections.usage(period, admin))),
			'connections.watch': () => Stream.unwrap(Effect.map(CurrentAdmin, connections.watch))
		})
	})
)
