import {question} from '#lib/question.ts'

export const noReinventedHelper = question(
	'code',
	'Does `code` hand-write, or reach by a longer route, a result that one operation of the language or a library `code` uses gives directly, with the same order, ties, duplicates and empty case?',
	{
		message: 'Call the library’s operation instead of rewriting it.',
		no: {
			cases: [
				'Operations neither the language nor the libraries `code` uses provide',
				'Hand-written code that does something the library call would not, such as a different tie-break, order, floor or empty result',
				'A loop whose body does more than the library operation, and separate passes answering different questions',
				'An intermediate collection `code` reads for several things, and a sort whose whole order is used',
				'Capitalising by upper-casing the first character, padding with a repeat of the missing width, a sum added up in a reduce from 0, an empty collector a loop fills, the head, emptiness or length of a filter or sort, subtraction comparators and collections copied in a reduce: lint and the compiler report these',
				'Source text a test hands to a parser or lint rule as a fixture'
			],
			example: `
				function longest(notes: Array.NonEmptyReadonlyArray<Note>) {
					return Array.max(Array.map(notes, note => note.words), Number.Order)
				}
			`
		},
		yes: {
			cases: [
				'Grouping, deduplicating, chunking, zipping, partitioning, flattening or finding a minimum or maximum by hand',
				'Sorting only to take one smallest or largest item, where a min or max keeps the same tie',
				'Hand-written retries, timeouts, debouncing or delays where the library `code` uses has them',
				'Hand-written padding, trimming, case conversion, deep equality or comparators the library offers',
				'An operation a library already offers for the same job, such as a client query or mutation',
				'A function whose body is one call with its parameters and fixed imported values, where the direct call reads as clearly at its sites; exact forwarding and fixed literals are owned by lint'
			],
			example: `
				function longest(notes: Array.NonEmptyReadonlyArray<Note>) {
					return Array.reduce(notes, Array.headNonEmpty(notes).words, (most, note) => Number.max(most, note.words))
				}
			`
		}
	}
)
