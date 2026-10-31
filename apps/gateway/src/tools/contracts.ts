import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

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
	}).annotate(Tool.Readonly, true)
)
