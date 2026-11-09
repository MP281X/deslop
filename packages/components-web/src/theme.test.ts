import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Number, Option, String, pipe} from 'effect'

const ROOT = `${import.meta.dirname}/../../..`

// Relative OKLCH preserves its Kanagawa source exactly; Expo accepts that source at its native color boundary.
function declarations(block: string) {
	return Array.map(
		Array.fromIterable(
			String.matchAll(/--([a-z-]+): (?:#([0-9a-f]{6})|oklch\(from #([0-9a-f]{6}) l c h\)|var\(--([a-z-]+)\));/gu)(block)
		),
		match => {
			if (match[2]) return [match[1] ?? '', `#${match[2]}`]
			if (match[3]) return [match[1] ?? '', `#${match[3]}`]
			return [match[1] ?? '', `var(--${match[4] ?? ''})`]
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

function luminance(hex: string) {
	const channels = Array.map(Array.fromIterable(String.matchAll(/[0-9a-f]{2}/gu)(hex)), match => {
		const channel = Option.getOrThrow(Number.parse(`0x${match[0]}`)) / 255
		if (channel <= 0.04045) return channel / 12.92
		return ((channel + 0.055) / 1.055) ** 2.4
	})
	assert.lengthOf(channels, 3)
	return (
		0.2126 * Array.getUnsafe(channels, 0) +
		0.7152 * Array.getUnsafe(channels, 1) +
		0.0722 * Array.getUnsafe(channels, 2)
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
			const hues = ['red', 'orange', 'amber', 'ivory', 'cyan', 'blue', 'purple', 'pink', 'slate']
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
		'keeps the light sheet bone and app and status colours readable on white',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const [light] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: dark)'
			)
			const entries = declarations(light)
			for (const entry of [
				['background', '#f2f0e8'],
				['popover', '#fbfaf4'],
				['primary-foreground', '#f2f0e8'],
				['foreground', '#11150f'],
				['card', '#fbfaf4'],
				['secondary', '#e7e7dc'],
				['muted', '#e7e7dc'],
				['muted-foreground', '#62685c'],
				['accent', '#dfe2d4'],
				['border', '#c7c9bc'],
				['input', '#b9bdaf']
			] as const) {
				assert.strictEqual(resolved(entries, entry[0]), entry[1], entry[0])
			}
			for (const name of [
				'blue',
				'cyan',
				'pink',
				'slate',
				'purple',
				'amber',
				'orange',
				'ivory',
				'coral',
				'destructive',
				'warning',
				'machine-dev',
				'machine-desktop'
			]) {
				const value = resolved(entries, name) ?? ''
				assert.match(value, /^#[0-9a-f]{6}$/u, name)
				assert.isAtLeast(1.05 / (luminance(value) + 0.05), 4.5, name)
			}
		})
	)

	test.effect(
		'keeps neutral selection, one radius and no green token in either appearance',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const source = yield* fs.readFileString(`${import.meta.dirname}/theme.css`)
			const [light, dark = ''] = String.split(source, '@media screen and (prefers-color-scheme: dark)')
			const darkDeclarations = [...declarations(dark), ...declarations(light)]
			assert.strictEqual(resolved(darkDeclarations, 'background'), '#050706')
			assert.strictEqual(resolved(darkDeclarations, 'foreground'), '#d9e2ce')
			assert.strictEqual(resolved(darkDeclarations, 'accent'), '#1b271c')
			assert.strictEqual(resolved(darkDeclarations, 'border'), '#283329')
			assert.strictEqual(resolved(darkDeclarations, 'primary'), '#b6ff3b')
			assert.strictEqual(resolved(darkDeclarations, 'machine-dev'), '#8fd3ff')
			assert.strictEqual(resolved(darkDeclarations, 'machine-desktop'), '#ffd166')
			assert.notInclude(source, '--green')
			assert.include(source, '--radius: 0px;')
			assert.include(
				yield* fs.readFileString(`${ROOT}/packages/components-mobile/src/theme.ts`),
				'export const radius = 0'
			)
			for (const size of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']) {
				assert.include(source, `--radius-${size}: var(--radius);`)
			}
		})
	)

	test.effect(
		'theme.css sets tokens only, never a component selector',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			assert.notMatch(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				/\[data-(?:slot|variant)/u,
				'theme.css sets tokens only: style a component through its variant, never a data-slot or data-variant selector.'
			)
		})
	)
})
