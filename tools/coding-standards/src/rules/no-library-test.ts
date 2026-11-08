import {judgedRule} from '#judge/rule.ts'

export const noLibraryTest = judgedRule({
	criteria: {
		false:
			'An owned schema refinement, transformation, security policy, composition, adapter or custom lint rule exercises owned behavior even when library functions run it.',
		true: 'The entire test only exercises an unmodified library primitive or language guarantee with no owned transformation, configuration or behavior under test.'
	},
	examples: {
		bad: `it('maps, filters and sorts arrays', () => {
	assert.deepEqual([1, 2, 3].map(value => value * 2), [2, 4, 6])
	assert.deepEqual([3, 1, 2].sort(), [1, 2, 3])
	assert.equal(JSON.parse('{"a":1}').a, 1)
})`,
		good: `it('reads a price written with a comma', () => {
	assert.equal(Schema.decodeUnknownSync(Price)('12,50'), 12.5)
})`
	},
	kind: 'test',
	message: 'Test behavior this code owns; a library, the framework and the type system test their own guarantees.',
	question:
		'Does the test in `code` exclusively re-test an unmodified library or language guarantee, with no owned behavior?'
})
