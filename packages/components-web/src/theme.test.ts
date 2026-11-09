import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Number, Option, String, pipe} from 'effect'

const ROOT = `${import.meta.dirname}/../../..`

function declarations(block: string) {
	return Array.map(Array.fromIterable(String.matchAll(/--([a-z0-9-]+): ([^;]+);/gu)(block)), match => [
		match[1] ?? '',
		String.trim(match[2] ?? '')
	])
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
			String.matchAll(
				/(\w+): DynamicColorIOS\(\{dark: '(#[0-9a-f]{6}|rgba\([0-9]+, [0-9]+, [0-9]+, [0-9.]+\))', light: '(#[0-9a-f]{6}|rgba\([0-9]+, [0-9]+, [0-9]+, [0-9.]+\))'\}\)/gu
			)(source)
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
		'keeps light surfaces cool and app and status colours readable on white',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const [light] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: dark)'
			)
			const entries = declarations(light)
			for (const entry of [
				['background', '#f2f6fb'],
				['popover', '#ffffff'],
				['primary-foreground', '#ffffff'],
				['foreground', '#0b1523'],
				['card', 'rgba(255, 255, 255, 0.75)'],
				['secondary', '#e7eff8'],
				['muted', '#edf3f9'],
				['muted-foreground', '#5f7186'],
				['accent', '#e2ebf5'],
				['border', '#cfdae8'],
				['input', '#d5e1ee']
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
		'keeps deep-ink tokens, a 16px card scale and no green token in either appearance',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const source = yield* fs.readFileString(`${import.meta.dirname}/theme.css`)
			const [light, dark = ''] = String.split(source, '@media screen and (prefers-color-scheme: dark)')
			const darkDeclarations = [...declarations(dark), ...declarations(light)]
			assert.strictEqual(resolved(darkDeclarations, 'background'), '#070b13')
			assert.strictEqual(resolved(darkDeclarations, 'foreground'), '#eaf2ff')
			assert.strictEqual(resolved(darkDeclarations, 'accent'), 'rgba(46, 70, 100, 0.55)')
			assert.strictEqual(resolved(darkDeclarations, 'border'), 'rgba(164, 194, 230, 0.18)')
			assert.strictEqual(resolved(darkDeclarations, 'machine-dev'), '#5eebff')
			assert.strictEqual(resolved(darkDeclarations, 'machine-desktop'), '#a78bfa')
			assert.notInclude(source, '--green')
			assert.include(source, '--radius: 16px;')
			assert.include(source, '--radius-md: 10px;')
			assert.include(source, '--radius-xl: 16px;')
			assert.include(
				yield* fs.readFileString(`${ROOT}/packages/components-mobile/src/theme.ts`),
				'export const radius = 16'
			)
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
