import {question} from '#lib/question.ts'

export const noTitleMismatchTest = question(
	'test',
	'Does the test in `code` contradict, or never check, the outcome its title promises?',
	{
		message: 'Make the title and the assertions agree: assert what the title promises, or retitle it.',
		no: {
			cases: [
				'A title that does not list every assertion',
				'A promise checked indirectly, such as by the effect completing, a schema decoding or a negative assertion',
				'A promise that setup, fixtures or imported helpers could check where `code` does not show'
			],
			example: `
				it('rejects an expired token', async () => {
					const response = await handler(expiredRequest)
					expect(response.status).toBe(401)
				})
			`
		},
		yes: {
			cases: [
				'An expected value that contradicts the title, such as a title saying rejects while the test expects status 200',
				'A title naming an outcome that no call or assertion in `code` checks'
			],
			example: `
				it('rejects an expired token', async () => {
					const response = await handler(expiredRequest)
					expect(response.status).toBe(200)
				})
			`
		}
	}
)
