import {question} from '#lib/question.ts'

export const noHiddenSideEffect = question(
	'code',
	'Does a function or callback in `code` that reads as a query or a pure transformation also perform a side effect?',
	{
		message: 'Keep queries and transformations pure; perform the side effect in its own command.',
		no: {
			cases: [
				'Functions named and used as commands, such as save, send, update or remove',
				'Atom, subscription or resource initializers that install listeners, register cleanup or publish state as their job',
				'An Effect that `code` returns for its caller to run, including test doubles that count calls',
				'Writes to a variable created inside the same function or callback',
				'Imported helpers whose behavior `code` does not show'
			],
			example: `
				function findDraft(notes: Note[]) {
					return Array.findFirst(notes, note => note.status === 'draft')
				}
			`
		},
		yes: {
			cases: [
				'A get, find, is, has, to, format, parse or compute function that also writes state, mutates its input, logs, sends a request or starts a timer',
				'A callback passed to map, filter, find, some, every, sort or a reducer that writes outside itself, sends or logs'
			],
			example: `
				function findDraft(notes: Note[]) {
					return Array.findFirst(notes, note => {
						analytics.track('draft-checked', note.id)
						return note.status === 'draft'
					})
				}
			`
		}
	}
)
