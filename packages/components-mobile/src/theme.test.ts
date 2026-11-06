import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Option, String, pipe} from 'effect'

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

function declarations(block: string) {
	return Array.map(
		Array.fromIterable(String.matchAll(/--([a-z-]+): (?:#([0-9a-f]{6})|var\(--([a-z-]+)\));/gu)(block)),
		match => {
			if (match[2]) return [match[1] ?? '', `#${match[2]}`]
			return [match[1] ?? '', `var(--${match[3] ?? ''})`]
		}
	)
}

function lookup(entries: string[][], name: string) {
	for (const entry of entries) {
		if (entry[0] === name) return entry[1]
	}
	return undefined
}

function resolved(entries: string[][], name: string) {
	const value = lookup(entries, name)
	if (value === undefined) return undefined
	if (String.startsWith('var(--')(value)) return resolved(entries, String.slice(6, -1)(value))
	return value
}

it.layer(NodeServices.layer)(test => {
	test.effect(
		'theme.ts matches theme.css for every shared color, dark and light',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const [light, dark = ''] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/../../../packages/components-web/src/theme.css`),
				'@media screen and (prefers-color-scheme: dark)'
			)
			const lightDeclarations = declarations(light)
			const darkDeclarations = [...declarations(dark), ...lightDeclarations]
			const found = pairs(yield* fs.readFileString(`${import.meta.dirname}/theme.ts`))
			assert.isNotEmpty(found)
			assert.deepStrictEqual(
				found,
				Array.map(found, color => ({
					dark: resolved(darkDeclarations, color.name),
					light: resolved(lightDeclarations, color.name),
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
