import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProvider} from '#services/ai-proxy/schema.ts'
import {ConnectionStatus, ServerId} from '#services/connections/schema.ts'

export const ToolContracts = Toolkit.make(
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
					error: Schema.OptionFromOptionalKey(Schema.String),
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
			'Use when the user asks to remove their provider key; removes it so their AI calls through Gateway stop using it.',
		failure: AuthError,
		parameters: Schema.Struct({provider: AiProvider.annotate({description: 'The provider whose key to remove.'})}),
		success: Schema.Struct({provider: AiProvider})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)
