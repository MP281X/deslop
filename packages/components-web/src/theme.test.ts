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
			const [dark, light = ''] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: light)'
			)
			const darkDeclarations = declarations(dark)
			const lightDeclarations = [...declarations(light), ...darkDeclarations]
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
		'keeps light surfaces neutral and app and status colours readable on white',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const [dark, light = ''] = String.split(
				yield* fs.readFileString(`${import.meta.dirname}/theme.css`),
				'@media screen and (prefers-color-scheme: light)'
			)
			const entries = [...declarations(light), ...declarations(dark)]
			for (const entry of [
				['background', '#fbfbfc'],
				['popover', '#ffffff'],
				['primary-foreground', '#ffffff'],
				['foreground', '#17181b'],
				['card', '#ffffff'],
				['secondary', '#f0f1f4'],
				['muted', '#f4f5f7'],
				['muted-foreground', '#6b7079'],
				['accent', '#eceef1'],
				['border', '#e7e8eb'],
				['input', '#d5d7dd']
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
				'success',
				'info',
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
		'keeps the dark ground, control and card radii, and no green token in either appearance',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const source = yield* fs.readFileString(`${import.meta.dirname}/theme.css`)
			const [dark, light = ''] = String.split(source, '@media screen and (prefers-color-scheme: light)')
			const darkDeclarations = declarations(dark)
			assert.strictEqual(resolved(darkDeclarations, 'background'), '#08090a')
			assert.strictEqual(resolved(darkDeclarations, 'foreground'), '#f7f8f8')
			assert.strictEqual(resolved(darkDeclarations, 'accent'), '#22262d')
			assert.strictEqual(resolved(darkDeclarations, 'border'), '#25282e')
			assert.strictEqual(resolved(darkDeclarations, 'machine-dev'), '#5e6ad2')
			assert.strictEqual(resolved(darkDeclarations, 'machine-desktop'), '#f2c94c')
			assert.notInclude(source, '--green')
			assert.include(source, '--radius: 6px;')
			assert.include(source, '--radius-card: 8px;')
			assert.include(
				yield* fs.readFileString(`${ROOT}/packages/components-mobile/src/theme.ts`),
				'export const radius = 10'
			)
			for (const size of ['xs', 'sm']) {
				assert.include(source, `--radius-${size}: calc(var(--radius) -`)
			}
			assert.include(source, '--radius-md: var(--radius);')
			for (const size of ['lg', 'xl', '2xl', '3xl', '4xl']) {
				assert.include(source, `--radius-${size}: var(--radius-card);`)
			}
			assert.include(light, '--background: #fbfbfc;')
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
