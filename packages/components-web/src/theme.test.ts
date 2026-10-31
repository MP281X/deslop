import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, String} from 'effect'

import {lint} from '@google/design.md/linter'

// Each variable the block sets to a hex color, by name.
function declarations(block: string) {
	return Array.map(Array.fromIterable(String.matchAll(/--([a-z-]+): (#[0-9a-f]{6});/gu)(block)), match => [
		match[1],
		match[2]
	])
}

it.layer(NodeServices.layer)(test => {
	test.effect(
		'theme.css sets every color to its DESIGN.md token, dark and light',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const design = lint(yield* fs.readFileString(`${import.meta.dirname}/../../../DESIGN.md`))
			const [light = '', dark = ''] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: dark)'
			)
			assert.strictEqual(design.summary.errors, 0)
			assert.deepStrictEqual(
				declarations(dark),
				Array.map(declarations(dark), entry => [entry[0], design.designSystem.colors.get(entry[0] ?? '')?.hex])
			)
			assert.deepStrictEqual(
				declarations(light),
				Array.map(declarations(light), entry => [entry[0], design.designSystem.colors.get(`light-${entry[0]}`)?.hex])
			)
		})
	)
})
