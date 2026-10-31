import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Option, String, pipe} from 'effect'

import {lint} from '@google/design.md/linter'

// Each color the theme names, with its dark and light values; theme.ts imports React Native, so its source is read as text.
function pairs(source: string) {
	return Array.map(
		Array.fromIterable(
			String.matchAll(/(\w+): DynamicColorIOS\(\{dark: '(#[0-9a-f]{6})', light: '(#[0-9a-f]{6})'\}\)/gu)(source)
		),
		match => ({
			dark: match[2],
			light: match[3],
			name: pipe(match[1] ?? '', String.camelToSnake, String.replaceAll('_', '-'))
		})
	)
}

it.layer(NodeServices.layer)(test => {
	test.effect(
		'theme.ts sets every color to its DESIGN.md token, dark and light',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const colors = lint(yield* fs.readFileString(`${import.meta.dirname}/../../../DESIGN.md`)).designSystem.colors
			const found = pairs(yield* fs.readFileString(`${import.meta.dirname}/theme.ts`))
			assert.isNotEmpty(found)
			assert.deepStrictEqual(
				found,
				Array.map(found, color => ({
					dark: colors.get(color.name)?.hex,
					light: colors.get(`light-${color.name}`)?.hex,
					name: color.name
				}))
			)
		})
	)

	test.effect(
		"each iOS app's primary is its hue in DESIGN.md's table",
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const root = `${import.meta.dirname}/../../..`
			const table = Array.map(
				Array.fromIterable(
					String.matchAll(/^\| ([a-z]+) +\| ([a-z]+) +\|/gmu)(yield* fs.readFileString(`${root}/DESIGN.md`))
				),
				match => ({app: match[1] ?? '', hue: match[2] ?? ''})
			)
			const mobile = yield* Effect.filter(table, row => fs.exists(`${root}/apps/${row.app}/app.config.ts`))
			assert.isNotEmpty(mobile)
			assert.deepStrictEqual(
				yield* Effect.forEach(
					mobile,
					row =>
						Effect.map(fs.readFileString(`${root}/apps/${row.app}/src/lib/utils.ts`), source => ({
							app: row.app,
							hue: Option.getOrElse(
								Option.flatMap(String.match(/export const primary = hues\.([a-z]+)/u)(source), match =>
									Option.fromUndefinedOr(match[1])
								),
								() => ''
							)
						})),
					{concurrency: 'unbounded'}
				),
				mobile
			)
		})
	)
})
