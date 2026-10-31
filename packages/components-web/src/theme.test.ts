import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Option, String, pipe} from 'effect'

import {lint} from '@google/design.md/linter'

const ROOT = `${import.meta.dirname}/../../..`

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
			const design = lint(yield* fs.readFileString(`${ROOT}/DESIGN.md`))
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
			const hues = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']
			assert.includeMembers(
				Array.map(declarations(dark), entry => entry[0]),
				hues
			)
			assert.includeMembers(
				Array.map(declarations(light), entry => entry[0]),
				hues
			)
		})
	)

	test.effect(
		"each web app's primary is its hue in DESIGN.md's table",
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const table = Array.map(
				Array.fromIterable(
					String.matchAll(/^\| ([a-z]+) +\| ([a-z]+) +\|/gmu)(yield* fs.readFileString(`${ROOT}/DESIGN.md`))
				),
				match => ({app: match[1] ?? '', hue: match[2] ?? ''})
			)
			const web = yield* Effect.filter(table, row => fs.exists(`${ROOT}/apps/${row.app}/src/routes/styles.css`))
			assert.isNotEmpty(web)
			assert.deepStrictEqual(
				yield* Effect.forEach(
					web,
					row =>
						Effect.map(fs.readFileString(`${ROOT}/apps/${row.app}/src/routes/styles.css`), css => ({
							app: row.app,
							// An app without its own --primary takes the theme's orange.
							hue: pipe(
								String.match(/--primary: var\(--([a-z]+)\)/u)(css),
								Option.flatMap(match => Option.fromUndefinedOr(match[1])),
								Option.getOrElse(() => 'orange')
							)
						})),
					{concurrency: 'unbounded'}
				),
				web
			)
		})
	)
})
