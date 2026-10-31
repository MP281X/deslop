import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, String, pipe} from 'effect'

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
})
