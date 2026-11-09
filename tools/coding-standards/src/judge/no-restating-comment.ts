import {question} from '#lib/question.ts'

export const noRestatingComment = question(
	'code',
	'Does a comment inside `code` only repeat what the next line does, or describe a past edit?',
	{
		message: 'Delete the comment, or replace it with the reason the code cannot say; history lives in git.',
		no: {
			cases: [
				'A comment giving a reason, constraint, unit, external format, invariant or library limitation',
				'A comment that explains why, even if it also says what',
				'String literals and log messages'
			],
			example: `
				function ids(notes: Note[]) {
					// Ids repeat across devices until a sync settles, so duplicates collapse here.
					const seen = new Set<string>()
					for (const note of notes) seen.add(note.id)
					return seen
				}
			`
		},
		yes: {
			cases: [
				'A comment restating the next statement in words, such as "create a new set" above new Set()',
				'A comment about history, such as "changed from an array in the refactor"'
			],
			example: `
				function ids(notes: Note[]) {
					// create a new set
					const seen = new Set<string>()
					for (const note of notes) seen.add(note.id)
					return seen
				}
			`
		}
	}
)
