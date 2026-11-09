import {question} from '#lib/question.ts'

export const noTautologicalExpectation = question(
	'test',
	'Does the test in `code` compute its expected value with the same logic as the code under test, instead of stating the expected outcome?',
	{
		message: 'Write the expected outcome out, so the test can disagree with the code.',
		no: {
			cases: [
				'Expected values written out literally',
				'An independent oracle, such as a property that holds for every input',
				'Fixtures built with helpers that do not compute the result'
			],
			example: `
				it('totals an invoice', () => {
					assert.strictEqual(total([{price: 2, quantity: 3}, {price: 5, quantity: 1}]), 11)
				})
			`
		},
		yes: {
			cases: [
				'An expected value built by re-implementing the function under test',
				'An expected value produced by calling the function under test, or a helper it uses'
			],
			example: `
				it('totals an invoice', () => {
					const lines = [{price: 2, quantity: 3}, {price: 5, quantity: 1}]
					assert.strictEqual(total(lines), Array.reduce(lines, 0, (sum, line) => sum + line.price * line.quantity))
				})
			`
		}
	}
)
