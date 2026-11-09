import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'
import {CurrentUser} from '@deslop/runtime/auth/utils'

import {AiProvider} from '#services/ai/schema.ts'
import {ServerId} from '#services/connections/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_mcp_connections', {
		description: "Each server's state, tool count and last failure; name a server to also read its own instructions.",
		parameters: Schema.Struct({
			server: Schema.optionalKey(
				ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
			)
		}),
		success: Schema.Struct({
			servers: Schema.Array(
				Schema.Struct({
					error: Schema.optionalKey(Schema.String),
					id: ServerId,
					instructions: Schema.optionalKey(Schema.String),
					status: Schema.Literals(['Connected', 'Not connected', 'Expired']),
					tools: Schema.Int
				})
			)
		})
	}).annotate(Tool.Readonly, true),
	Tool.make('remove_mcp_server', {
		dependencies: [CurrentUser],
		description: 'Remove an MCP server everyone shares, by the id list_mcp_connections returns.',
		failure: AuthError,
		parameters: Schema.Struct({
			server: ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
		})
	}).annotate(Tool.Destructive, true),
	Tool.make('remove_ai_key', {
		dependencies: [CurrentUser],
		description: 'Remove your own provider key, so your AI calls through Gateway stop using it.',
		failure: AuthError,
		parameters: Schema.Struct({provider: AiProvider})
	}).annotate(Tool.Destructive, true)
)
