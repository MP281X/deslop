#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Console, Effect, FileSystem, Number, Option, Order, Path, Record, String, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

// The tokens native code paints with, by their theme.css names; every hue the theme writes as a hex comes along.
const COLORS = ['background', 'card', 'destructive', 'foreground', 'muted-foreground', 'primary-foreground', 'warning']

const HEADER =
	"// Generated from components-web's theme.css by `vp run fix`. Expo's native color boundary accepts sRGB, not OKLCH, and an app config hands these to native code that cannot import the theme."

// The sRGB transfer curve over a linear channel.
function encode(linear: number) {
	if (linear <= 0.0031308) return 12.92 * linear
	return 1.055 * linear ** (1 / 2.4) - 0.055
}

function hexByte(linear: number) {
	return String.padStart(
		2,
		'0'
	)(Number.round(encode(Number.clamp(linear, {maximum: 1, minimum: 0})) * 255, 0).toString(16))
}

// OKLCH to sRGB through OKLab, with the matrices CSS Color 4 uses.
function oklchToHex(lightness: number, chroma: number, hue: number) {
	const a = chroma * Math.cos((hue * Math.PI) / 180)
	const b = chroma * Math.sin((hue * Math.PI) / 180)
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
	return pipe(
		[
			4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
			-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
			-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
		],
		Array.map(hexByte),
		Array.join(''),
		hex => `#${hex}`
	)
}

// A theme value as a hex: a hue the theme writes as `oklch(from #hex l c h)` is that hex; a neutral is converted.
function hexOf(value: string) {
	return pipe(
		String.match(/^oklch\(from (#[\da-f]{6}) l c h\)$/u)(value),
		Option.flatMap(match => Option.fromUndefinedOr(match[1])),
		Option.orElse(() =>
			pipe(
				String.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/u)(value),
				Option.flatMap(match =>
					Option.all([Number.parse(match[1] ?? ''), Number.parse(match[2] ?? ''), Number.parse(match[3] ?? '')])
				),
				Option.map(channels => oklchToHex(...channels))
			)
		)
	)
}

// Each custom property the `:root` block opening the text declares, by name.
function declarations(text: string) {
	return pipe(
		Array.headNonEmpty(String.split(text, '}')),
		String.split(';'),
		Array.map(String.match(/--([a-z\d-]+):\s*(.+)$/su)),
		Array.getSomes,
		Array.map(match => [match[1] ?? '', match[2] ?? ''] as const),
		Record.fromEntries
	)
}

function render(light: Record<string, string>, dark: Record<string, string>) {
	function entry(name: string) {
		return Option.map(
			Option.all({dark: hexOf(dark[name] ?? light[name] ?? ''), light: hexOf(light[name] ?? '')}),
			hexes => `\t\t${String.camelCase(name)}: {dark: '${hexes.dark}', light: '${hexes.light}'}`
		)
	}
	function group(names: readonly string[]) {
		return pipe(names, Array.sort(Order.String), Array.map(entry), Array.getSomes, Array.join(',\n'))
	}
	const hues = Array.filter(
		Record.keys(light),
		name => !Array.contains(COLORS, name) && String.startsWith('oklch(from #')(light[name] ?? '')
	)
	return `${HEADER}\nexport const palette = {\n\tcolors: {\n${group(COLORS)}\n\t},\n\thues: {\n${group(hues)}\n\t}\n}\n`
}

const palette = Command.make(
	'palette',
	{
		check: pipe(
			Flag.Boolean('check'),
			Flag.withDescription('Fail when the palette differs from the theme, writing nothing'),
			Flag.withDefault(false)
		)
	},
	Effect.fnUntraced(function* (input) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const theme = yield* fs.readFileString(path.resolve(import.meta.dirname, '../../components-web/src/theme.css'))
		const target = path.resolve(import.meta.dirname, '../src/palette.ts')
		const [, light = '', dark = ''] = String.split(theme, ':root {')
		const generated = render(declarations(light), declarations(dark))
		if (!input.check) return yield* fs.writeFileString(target, generated)
		if (generated === (yield* fs.readFileString(target))) return
		yield* Console.error('palette.ts differs from theme.css; run `vp run fix`.')
		return yield* Effect.fail('palette drift')
	})
)

NodeRuntime.runMain(
	Effect.provide(
		pipe(
			palette,
			Command.withDescription("Write the mobile palette from components-web's theme.css."),
			Command.run({version: '0.0.0'})
		),
		NodeServices.layer
	)
)
