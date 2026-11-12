import {question} from '#lib/question.ts'

export const noRoundaboutComputation = question(
	'code',
	'Does `code` reach a result through a longer route than one direct operation would take?',
	{
		message: 'Use the direct operation; it says what the code means and does less work.',
		no: {
			cases: [
				'An intermediate collection `code` uses for several observations, such as its size and its items’ fields',
				'A sort whose whole order is used',
				'A route where the direct operation would change the result, such as its order, ties or duplicates',
				'One step a direct operation would not shorten',
				'Mapping to values and then reducing them, such as totals per index and then their maximum',
				'Separate passes answering different questions, which one pass could only fuse with extra state',
				'Comparing every pair of a handful of items, where the pair relation has no key to index by',
				'The head or first index of a sort or a filter, an emptiness test of a filter and the length of a filter: lint reports these',
				'Source text a test hands to a parser or lint rule as a fixture'
			],
			example: `
				function hasPinned(notes: Note[]) {
					return Array.some(notes, note => note.pinned)
				}
			`
		},
		yes: {
			cases: [
				'Sorting only to take one smallest or largest item, where a min or max would do',
				'Filtering a list, then taking its first item, where a find would do',
				'Building a collection only to test whether it is empty or how large it is',
				'Two passes or nested loops over data one pass handles'
			],
			example: `
				function highestRank(notes: Array.NonEmptyReadonlyArray<Note>) {
					return Array.lastNonEmpty(Array.sort(notes, Order.mapInput(Order.Number, note => note.rank)))
				}
			`
		}
	}
)
