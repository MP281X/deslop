import {question} from '#lib/question.ts'

export const noMultiBehaviorTest = question(
	'test',
	'Does the test in `code` check two or more unrelated behaviors that share no scenario?',
	{
		message: 'Split it so each test names one behavior and fails for one reason.',
		no: {
			cases: [
				'Several inputs or boundary cases of one behavior',
				'Related fields of one result',
				'Success and failure of one policy',
				'Successive steps of one lifecycle'
			],
			example: `
				it('slugs keep only lowercase letters, digits and dashes', () => {
					expect(slugify('Hello, World!')).toBe('hello-world')
					expect(slugify('  A  B  ')).toBe('a-b')
				})
			`
		},
		yes: {
			cases: ['Assertions on independent operations, such as slug formatting and price formatting, in one test'],
			example: `
				it('works', () => {
					expect(slugify('Hello World')).toBe('hello-world')
					expect(formatPrice(12, 'EUR')).toBe('€12.00')
				})
			`
		}
	}
)
