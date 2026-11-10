import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

import {palette} from '#components/palette.ts'

// Expo's native color boundary accepts sRGB, not OKLCH; these match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: palette.background, light: '#ffffff'}),
	border: DynamicColorIOS({dark: palette.border, light: '#e4e4e7'}),
	card: DynamicColorIOS({dark: palette.card, light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: palette.destructive, light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: palette.foreground, light: '#09090b'}),
	mutedForeground: DynamicColorIOS({dark: palette.mutedForeground, light: '#71717b'}),
	primaryForeground: DynamicColorIOS({dark: palette.primaryForeground, light: '#ffffff'}),
	surface: DynamicColorIOS({dark: palette.surface, light: '#fafafa'}),
	warning: DynamicColorIOS({dark: palette.warning, light: '#a3530b'})
}

export const hues = {
	amber: DynamicColorIOS({dark: palette.amber, light: '#91601d'}),
	blue: DynamicColorIOS({dark: palette.blue, light: '#345dad'}),
	cyan: DynamicColorIOS({dark: palette.cyan, light: '#25777a'}),
	ivory: DynamicColorIOS({dark: palette.ivory, light: '#686868'}),
	orange: DynamicColorIOS({dark: palette.orange, light: '#b64b11'}),
	pink: DynamicColorIOS({dark: palette.pink, light: '#a63c69'}),
	purple: DynamicColorIOS({dark: palette.purple, light: '#74519b'}),
	slate: DynamicColorIOS({dark: palette.slate, light: '#526887'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// Concentric with the system's list rows, sheets and icon tiles.
export const radius = 12

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'caption'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({textStyle: 'footnote'}),
	display: font({textStyle: 'largeTitle', weight: 'bold'}),
	label: font({textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
