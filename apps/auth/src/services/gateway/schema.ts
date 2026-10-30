import {Schema} from 'effect'

import {McpSchema} from 'effect/ai'

import {ConnectionInfo} from '#services/connections/schema.ts'

export type ServerStatus = typeof ServerStatus.Type
export const ServerStatus = Schema.Struct({...ConnectionInfo.fields, error: Schema.optionalKey(Schema.String)})

export type ToolArguments = typeof ToolArguments.Type
export const ToolArguments = Schema.Record(Schema.String, Schema.Unknown)
export type ToolRequest = typeof ToolRequest.Type
export const ToolRequest = Schema.Struct({method: Schema.Literal('tools/list')})

export type RemoteTools = typeof RemoteTools.Type
export const RemoteTools = Schema.Array(McpSchema.Tool)
