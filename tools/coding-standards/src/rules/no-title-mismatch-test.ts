import {judgedRule} from '#judge/rule.ts'

export const noTitleMismatchTest = judgedRule({
	criteria: {
		false:
			'A scenario title need not enumerate every assertion. Successful effect completion, schema decoding, aggregate assertions and negative assertions may check the promise indirectly. When setup, fixture data or imported helpers could establish the promise, missing context is not a mismatch.',
		true: 'The title promises a concrete outcome but an explicit expected result contradicts it, or the test never executes or checks the promised operation at all. The mismatch must be demonstrable without knowing fixture or helper implementations.'
	},
	examples: {
		bad: `it('rejects an expired token and logs the reason', async () => {
	const response = await handler(new Request('https://app/api', {headers: {authorization: 'Bearer old'}}))
	expect(response.status).toBe(200)
})`,
		good: `it('rejects an expired token', async () => {
	const response = await handler(new Request('https://app/api', {headers: {authorization: 'Bearer old'}}))
	expect(response.status).toBe(401)
})`
	},
	kind: 'test',
	message: 'Make the title and the assertions agree: assert what the title promises, or retitle it.',
	question: 'Does the title of the test in `code` make a concrete promise its visible executable checks fail to verify?'
})
