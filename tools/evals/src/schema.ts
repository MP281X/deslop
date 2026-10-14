import {Schema} from 'effect'

type EvalCase = typeof EvalCase.Type
export const EvalCase = Schema.Struct({
	criteria: Schema.NonEmptyString,
	id: Schema.NonEmptyString,
	task: Schema.NonEmptyString
})

export type Run = typeof Run.Type
const Run = Schema.Struct({
	case: Schema.String,
	criteria: Schema.String,
	harness: Schema.Literals(['claude', 'codex']),
	home: Schema.String,
	id: Schema.String,
	instance: Schema.String,
	repo: Schema.String,
	seed: Schema.String,
	task: Schema.String,
	threadId: Schema.NullOr(Schema.String)
})

export type Manifest = typeof Manifest.Type
export const Manifest = Schema.Struct({
	directory: Schema.String,
	runs: Schema.Array(Run),
	skill: Schema.String,
	version: Schema.String
})

export type Usage = typeof Usage.Type
const Usage = Schema.Struct({
	cache_creation_input_tokens: Schema.optionalKey(Schema.Finite),
	cache_read_input_tokens: Schema.optionalKey(Schema.Finite),
	cache_write_input_tokens: Schema.optionalKey(Schema.Finite),
	cached_input_tokens: Schema.optionalKey(Schema.Finite),
	input_tokens: Schema.optionalKey(Schema.Finite),
	output_tokens: Schema.optionalKey(Schema.Finite),
	output_tokens_details: Schema.optionalKey(Schema.Struct({thinking_tokens: Schema.optionalKey(Schema.Finite)})),
	reasoning_output_tokens: Schema.optionalKey(Schema.Finite)
})
export type Block = typeof Block.Type
const Block = Schema.Struct({
	content: Schema.optionalKey(Schema.Unknown),
	id: Schema.optionalKey(Schema.String),
	input: Schema.optionalKey(Schema.Unknown),
	is_error: Schema.optionalKey(Schema.Boolean),
	name: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
	tool_use_id: Schema.optionalKey(Schema.String),
	type: Schema.String
})

export type NativeRecord = typeof NativeRecord.Type
export const NativeRecord = Schema.Struct({
	message: Schema.optionalKey(
		Schema.Struct({
			content: Schema.Union([Schema.String, Schema.Array(Block)]),
			id: Schema.optionalKey(Schema.String),
			stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
			usage: Schema.optionalKey(Usage)
		})
	),
	payload: Schema.optionalKey(
		Schema.Struct({
			arguments: Schema.optionalKey(Schema.String),
			call_id: Schema.optionalKey(Schema.String),
			channel: Schema.optionalKey(Schema.String),
			content: Schema.optionalKey(Schema.Array(Block)),
			info: Schema.optionalKey(Schema.NullOr(Schema.Struct({total_token_usage: Schema.optionalKey(Usage)}))),
			input: Schema.optionalKey(Schema.String),
			name: Schema.optionalKey(Schema.String),
			output: Schema.optionalKey(Schema.Unknown),
			phase: Schema.optionalKey(Schema.String),
			role: Schema.optionalKey(Schema.String),
			type: Schema.optionalKey(Schema.String),
			usage: Schema.optionalKey(Usage)
		})
	),
	timestamp: Schema.optionalKey(Schema.String),
	type: Schema.String
})

export type Transcript = typeof Transcript.Type
export const Transcript = Schema.Array(NativeRecord)

export type Event = typeof Event.Type
const Event = Schema.Struct({
	failed: Schema.NullOr(Schema.Boolean),
	id: Schema.String,
	kind: Schema.Literals(['call', 'result', 'reply', 'commentary']),
	name: Schema.String,
	text: Schema.String,
	timestamp: Schema.NullOr(Schema.String)
})

export class EvalError extends Schema.TaggedError<EvalError>()('EvalError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
