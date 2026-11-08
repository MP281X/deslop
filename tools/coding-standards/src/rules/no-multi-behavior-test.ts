import {judgedRule} from '#judge/rule.ts'

export const noMultiBehaviorTest = judgedRule({
	criteria: {
		false:
			'Multiple inputs, boundary cases, related output fields, success and failure variants of one policy, or successive steps of one lifecycle are one behavior. Assertion count and helper count alone are not evidence.',
		true: 'The test independently asserts unrelated operations or policies that share no causal scenario, such as slug formatting, loading configuration and formatting currency bundled together.'
	},
	examples: {
		bad: `it('works', async () => {
	expect(slugify('Hello World')).toBe('hello-world')
	expect(await loadConfig('missing.json')).toEqual(defaults)
	expect(formatPrice(12, 'EUR')).toBe('€12.00')
})`,
		good: `it('slugs keep only lowercase letters, digits and dashes', () => {
	expect(slugify('Hello, World!')).toBe('hello-world')
	expect(slugify('  A  B  ')).toBe('a-b')
})`
	},
	kind: 'test',
	message: 'Split it so each test names one behavior and fails for one reason.',
	question:
		'Does the single test in `code` bundle assertions of unrelated behaviors rather than variants or steps of one scenario?'
})
