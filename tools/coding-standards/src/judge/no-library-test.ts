import {question} from '#lib/question.ts'

export const noLibraryTest = question(
	'test',
	'Does the test in `code` exercise only a library or language feature, with none of the project’s own code?',
	{
		message: 'Test behavior this code owns; a library and the language test their own guarantees.',
		no: {
			cases: [
				'A schema, transformation, policy, adapter, composition or lint rule the project defines, even when library functions run it',
				'A library the project configures'
			],
			example: `
				it('reads a price written with a comma', () => {
					expect(Schema.decodeUnknownSync(Price)('12,50')).toBe(12.5)
				})
			`
		},
		yes: {
			cases: [
				'Every assertion checks a built-in or third-party function used directly, such as Array.prototype.sort or JSON.parse, with no project function, schema or configuration involved'
			],
			example: `
				it('sorts numbers', () => {
					expect([3, 1, 2].sort()).toEqual([1, 2, 3])
				})
			`
		}
	}
)
