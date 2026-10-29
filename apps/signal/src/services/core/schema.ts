import {Schema} from 'effect'

import {Command} from '#services/game/schema.ts'

// What a team's model decided in a round: what it said and thought, the commands it gave, and the tool calls that did not decode.
export type Decision = typeof Decision.Type
export const Decision = Schema.Struct({
	commands: Schema.Array(Command),
	invalid: Schema.Array(Schema.String),
	reasoning: Schema.optionalKey(Schema.String),
	text: Schema.String,
	tokens: Schema.optionalKey(Schema.Struct({input: Schema.Int, output: Schema.Int}))
})
