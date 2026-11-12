import {question} from '#lib/question.ts'

export const noRestatingComment = question(
	'code',
	'Does a comment in `code` say what the code or its names already show, or describe a past edit?',
	{
		gate: unit => unit.comment,
		message:
			'Delete the comment; if the code needs it, rename or restructure until it explains itself. Comment only a reason the code cannot show, in one short sentence; history lives in git.',
		no: {
			cases: [
				'One short sentence giving a reason, constraint, unit, external format, invariant or library limitation',
				'String literals and log messages'
			],
			example: `
				function ids(notes: Note[]) {
					// Ids repeat across devices until a sync settles.
					return new Set(notes.map(note => note.id))
				}
			`
		},
		yes: {
			cases: [
				'A comment restating the next statement in words, such as "create a new set" above new Set()',
				'A comment above a declaration saying what it is or does, which its name, type and body already show',
				'A comment carrying what a better name would say',
				'A comment about history, such as "changed from an array in the refactor"'
			],
			example: `
				// The unique ids of the given notes.
				function ids(notes: Note[]) {
					// create a new set
					return new Set(notes.map(note => note.id))
				}
			`
		}
	}
)
