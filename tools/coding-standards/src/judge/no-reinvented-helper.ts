import {question} from '#lib/question.ts'

export const noReinventedHelper = question(
	'code',
	'Does `code` hand-write an operation that the language or a library `code` uses already provides as one call?',
	{
		message: 'Call the library’s operation instead of rewriting it.',
		no: {
			cases: [
				'Operations neither the language nor the libraries `code` uses provide',
				'Hand-written code that does something the library call would not, such as a different tie-break or order',
				'A loop whose body does more than the library operation',
				'Capitalising by upper-casing the first character, padding with a repeat of the missing width, a sum added up in a reduce from 0, an empty collector a loop fills, subtraction comparators and collections copied in a reduce: lint and the compiler report these'
			],
			example: `
				function longest(notes: Array.NonEmptyReadonlyArray<Note>) {
					return Array.max(Array.map(notes, note => note.words), Number.Order)
				}
			`
		},
		yes: {
			cases: [
				'Grouping, deduplicating, chunking, zipping, partitioning, flattening or finding a minimum or maximum by hand, including a reduce with a fixed floor',
				'Hand-written retries, timeouts, debouncing or delays where the library `code` uses has them',
				'Hand-written padding, trimming, case conversion, deep equality or comparators the library offers',
				'An operation a library already offers for the same job, such as a client query or mutation',
				'A function whose body is one call with its parameters and fixed imported values, where the direct call reads as clearly at its sites; exact forwarding and fixed literals are owned by lint'
			],
			example: `
				function longest(notes: Note[]) {
					return Array.reduce(notes, 0, (most, note) => Number.max(most, note.words))
				}
			`
		}
	}
)
