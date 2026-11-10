import {Schema} from 'effect'

import {Operation, Range} from '#services/telemetry/schema.ts'

export type Pane = typeof Pane.Type
export const Pane = Schema.Literals(['Traces', 'Trace', 'Span'])

export type Attributes = typeof Attributes.Type
export const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))

export type Wrapped = typeof Wrapped.Type
export const Wrapped = Schema.Record(Schema.String, Schema.Json)

export type OperationKey = typeof OperationKey.Type
export const OperationKey = Schema.Struct({
	app: Schema.String,
	name: Operation.fields.name,
	runtime: Operation.fields.runtime
})

export type Selection = typeof Selection.Type
export const Selection = Schema.Struct({
	operation: OperationKey,
	spanId: Schema.optionalKey(Schema.String),
	traceId: Schema.optionalKey(Schema.String)
})

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	operation: Schema.optionalKey(Schema.String),
	pane: Schema.optionalKey(Pane),
	range: Schema.optionalKey(Range),
	side: Schema.optionalKey(Operation.fields.runtime),
	source: Schema.optionalKey(Schema.String),
	span: Schema.optionalKey(Schema.String),
	trace: Schema.optionalKey(Schema.String)
})
