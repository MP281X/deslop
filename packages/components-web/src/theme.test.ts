import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, String, pipe} from 'effect'

const ROOT = `${import.meta.dirname}/../../..`

// Each variable the block sets to a hex color, by name.
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
		'theme.css matches theme.ts for every shared color, dark and light',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const mobile = pairs(yield* fs.readFileString(`${ROOT}/packages/components-mobile/src/theme.ts`))
			const [light, dark = ''] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: dark)'
			)
			const lightDeclarations = declarations(light)
			const darkDeclarations = [...declarations(dark), ...lightDeclarations]
			assert.isNotEmpty(mobile)
			assert.deepStrictEqual(
				Array.map(mobile, color => ({
					dark: resolved(darkDeclarations, color.name),
					light: resolved(lightDeclarations, color.name),
					name: color.name
				})),
				mobile
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
})
