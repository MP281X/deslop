import {question} from '#lib/question.ts'

export const noInternalsTest = question(
	'test',
	'Does an assertion in `code` depend on how the code under test does its work rather than the answer its caller gets?',
	{
		message: 'Assert the answer a caller gets.',
		no: {
			cases: ['Assertions check returned answers.', 'A stand-in supplies inputs for the scenario.'],
			example: `
				import {assert, it} from '@effect/vitest'

				export function checkTotal(total: (prices: number[]) => number) {
					it('totals prices', () => { assert.strictEqual(total([2, 3]), 5) })
				}
			`
		},
		yes: {
			cases: [
				'Assertions inspect storage layout.',
				'Assertions count internal operations rather than checking their result.'
			],
			example: `
				import {assert, it} from '@effect/vitest'

				export function checkTotal(total: (prices: number[]) => {answer: number; additions: number}) {
					it('totals prices', () => { assert.strictEqual(total([2, 3]).additions, 2) })
				}
			`
		}
	}
)
