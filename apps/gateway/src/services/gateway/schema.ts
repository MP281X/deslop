import {Schema} from 'effect'

import {McpSchema} from 'effect/ai'

export type ToolArguments = typeof ToolArguments.Type
export const ToolArguments = Schema.Record(Schema.String, Schema.Unknown)
export type ToolRequest = typeof ToolRequest.Type
export const ToolRequest = Schema.Struct({method: Schema.Literal('tools/list')})

export type RemoteTool = typeof RemoteTool.Type
export const RemoteTool = Schema.Struct({
	...McpSchema.Tool.fields,
	inputSchema: Schema.StructWithRest(
		Schema.Struct({
			properties: Schema.OptionFromOptionalKey(
				Schema.Record(Schema.String, Schema.Union([Schema.Record(Schema.String, Schema.Unknown), Schema.Boolean]))
			),
			required: McpSchema.optional(Schema.Array(Schema.String)),
			type: Schema.Literal('object')
		}),
		[Schema.Record(Schema.String, Schema.Unknown)]
	)
})

export type RemoteTools = typeof RemoteTools.Type
export const RemoteTools = Schema.Array(RemoteTool)

export type ToolAvailability = typeof ToolAvailability.Type
// The SDK returns execution metadata too; only whether a task is required affects the relay.
export const ToolAvailability = Schema.Struct({
	execution: Schema.OptionFromOptional(Schema.Struct({taskSupport: Schema.OptionFromOptional(Schema.String)}))
})

export type RemoteCallResult = typeof RemoteCallResult.Type
export const RemoteCallResult = Schema.Struct({
	...McpSchema.CallToolResult.fields,
	isError: Schema.OptionFromOptionalKey(Schema.Boolean)
})
