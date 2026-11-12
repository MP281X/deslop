import {assert, it} from '@effect/vitest'

import {Array, Record} from 'effect'

import {factsOf} from '#map/facts.ts'
import {classify} from '#map/moves.ts'

function factsFrom(files: Record<string, string[]>) {
	return Record.map(files, (lines, file) => factsOf(file, Array.join(lines, '\n')))
}

function change(from: string, file = from) {
	return {added: 1, file, from, removed: 1}
}

it('reads a file whose imports alone changed, even dropping a namespace qualifier, as following moved code', () => {
	const found = classify(
		[change('src/main.ts')],
		factsFrom({'src/main.ts': ["import * as Runtime from 'runtime/web'", 'export const router = Runtime.mount(tree)']}),
		factsFrom({'src/main.ts': ["import {mount} from 'components/router'", 'export const router = mount(tree)']})
	)
	assert.deepStrictEqual(
		Array.map(found.files, file => [file.kind, file.lines]),
		[['imports', 0]]
	)
})

it('finds a declaration in another file as moved, and counts only the lines an edit on the way changed', () => {
	const found = classify(
		[change('src/tools.ts'), change('src/utils.ts')],
		factsFrom({
			'src/tools.ts': [
				'export function rank(a: number) {',
				'\treturn a',
				'}',
				'export function order(a: number) {',
				'\tconst b = a + 1',
				'\tconst c = b * 2',
				'\treturn c',
				'}'
			],
			'src/utils.ts': ['export const one = 1']
		}),
		factsFrom({
			'src/utils.ts': [
				'export const one = 1',
				'export function rank(a: number) {',
				'\treturn a',
				'}',
				'export function order(a: number) {',
				'\tconst b = a + 1',
				'\tconst c = b * 3',
				'\treturn c',
				'}'
			]
		})
	)
	assert.deepStrictEqual(
		Array.map(found.files, file => [file.file, file.kind, file.lines]),
		[
			['src/tools.ts', 'moved', 0],
			['src/utils.ts', 'edited', 2]
		]
	)
	assert.deepStrictEqual(
		Array.map(found.moves, move => [move.name, move.edited]),
		[
			['rank', false],
			['order', true]
		]
	)
})

it('reads a declaration replaced by an import of the same name as a duplicate dropped for the original', () => {
	const found = classify(
		[change('src/bar.tsx')],
		factsFrom({'src/bar.tsx': ['const Account = Schema.Struct({id: Schema.String})', 'export const bar = Account']}),
		factsFrom({'src/bar.tsx': ["import {Account} from 'runtime/schema'", 'export const bar = Account']})
	)
	assert.deepStrictEqual(found.reuses, [{file: 'src/bar.tsx', name: 'Account', source: 'runtime/schema'}])
})
