import {question} from '#lib/question.ts'

export const noVacuousAssertion = question(
	'test',
	'Does the test in `code` check its promised outcome only with assertions that would still pass if the code under test did nothing or returned nothing?',
	{
		message: 'Assert the expected outcome itself, so the test fails when the behavior is missing.',
		no: {
			cases: [
				'Tests that also assert the exact values, counts or members of the outcome the title promises; an exact assertion about something else does not count',
				'A test whose promised behavior is that nothing happens or nothing is returned',
				'Assertions inside helpers `code` does not show',
				'An assertion whose two arguments are written the same, with no call: lint reports it'
			],
			example: `
				it('keeps active sessions after cleanup', () => {
					assert.deepStrictEqual(Array.map(cleanup(sessions), session => session.id), ['a', 'b'])
				})
			`
		},
		yes: {
			cases: [
				'Checking that every item of a result has a property, without checking the result holds the expected items',
				'Asserting only that no error was thrown, or that a value is defined, when the title promises a specific outcome',
				'Comparing a value with the input the test passed in, or with itself computed again'
			],
			example: `
				it('keeps active sessions after cleanup', () => {
					assert.isTrue(Array.every(cleanup(sessions), session => session.active))
				})
			`
		}
	}
)
