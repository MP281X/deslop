import {question} from '#lib/question.ts'

export const noTautologicalExpectation = question(
	'test',
	'Does the test in `code` compute its expected value with the same logic as the code under test, instead of stating the expected outcome?',
	{
		message: 'Write the expected outcome out so the test can disagree with the code.',
		no: {
			cases: ['The expected answer is written out.', 'An independent oracle does not repeat the implementation.'],
			example: `
				import {assert, it} from '@effect/vitest'

				export function checkTotal(total: (prices: number[]) => number) {
					it('totals prices', () => { assert.strictEqual(total([2, 3]), 5) })
				}
			`
		},
		yes: {
			cases: ['The expected answer repeats the implementation’s calculation.'],
			example: `
				import {assert, it} from '@effect/vitest'

				export function checkTotal(total: (prices: number[]) => number) {
					it('totals prices', () => { assert.strictEqual(total([2, 3]), 2 + 3) })
				}
			`
		}
	}
)
