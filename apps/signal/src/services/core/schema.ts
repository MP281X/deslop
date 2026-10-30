import {Schema} from 'effect'

import {Command, Entry} from '#services/game/schema.ts'

// What a team's model decided in a round: what it said and thought, the commands it gave, and the tool calls that did not decode.
export type Thought = typeof Thought.Type
export const Thought = Schema.Struct({
	commands: Schema.Array(Command),
	invalid: Schema.Array(Schema.String),
	reasoning: Schema.optionalKey(Schema.String),
	text: Schema.String,
	tokens: Entry.fields.tokens
})

export type Turn = typeof Turn.Type
export const Turn = Schema.Struct({
	content: Schema.String,
	role: Schema.Literals(['user', 'assistant']),
	sequence: Schema.Int
})

export type Conversation = typeof Conversation.Type
export const Conversation = Schema.Struct({
	measured: Schema.Int,
	sequence: Schema.Int,
	summary: Schema.String,
	turns: Schema.Array(Turn)
})

export type LocalChoice = typeof LocalChoice.Type
export const LocalChoice = Schema.Struct({
	actor: Schema.Int,
	choice: Schema.String,
	confidence: Schema.optionalKey(Schema.Finite),
	cost: Schema.optionalKey(Schema.Finite),
	input: Schema.Int,
	output: Schema.Int,
	tick: Schema.Int
})
