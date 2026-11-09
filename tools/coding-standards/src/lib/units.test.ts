import {assert, it} from '@effect/vitest'

import {Array, String} from 'effect'

import {units} from '#lib/units.ts'

// Each unit the judge would ask about, as its kind and first line.
function judgedUnits(filename: string, lines: string[]) {
	return Array.map(units(filename, Array.join(lines, '\n')), unit => `${unit.kind}:${unit.line}`)
}

function body(count: number) {
	return Array.makeBy(count, index => `\tconst value${index} = ${index}`)
}

it('judges whole functions up to 150 lines, the parts of a longer one, and each test case alone', () => {
	assert.deepStrictEqual(
		judgedUnits('src/page.tsx', [
			'export function Page() {',
			...body(5),
			'\treturn null',
			'}',
			'const short = () => 1',
			'export function helper() {',
			...body(160),
			'\tconst inner = () => {',
			...body(6),
			'\t}',
			'}'
		]),
		['component:1', 'code:171']
	)
	assert.deepStrictEqual(
		judgedUnits('src/page.test.ts', [
			"it('first', () => {",
			...body(2),
			'})',
			"it.effect('second', () => Effect.void)"
		]),
		['test:1', 'test:5']
	)
	assert.isTrue(
		Array.every(judgedUnits('src/page.ts', ['export function Page() {', ...body(6), '}']), String.startsWith('code'))
	)
})
