import {question} from '#lib/question.ts'

export const noImpossibleState = question(
	'code',
	'Does `code` model one thing’s state with several booleans or optional fields that can combine into states that should never exist?',
	{
		message: 'Give each real state one shape in a discriminated union.',
		no: {
			cases: ['Independent settings can really combine.', 'One union member represents each state.'],
			example: `
				import {Schema} from 'effect'

				export type Upload = typeof Upload.Type
				export const Upload = Schema.Union([
					Schema.TaggedStruct('Idle', {}), Schema.TaggedStruct('Uploading', {}), Schema.TaggedStruct('Failed', {reason: Schema.String}), Schema.TaggedStruct('Done', {url: Schema.String})
				])
			`
		},
		yes: {
			cases: ['Separate flags for one process can disagree.', 'Optional result fields permit contradictory states.'],
			example: `
				import {Schema} from 'effect'

				export type Upload = typeof Upload.Type
				export const Upload = Schema.Struct({
					failed: Schema.Boolean, uploading: Schema.Boolean, url: Schema.optional(Schema.String)
				})
			`
		}
	}
)
