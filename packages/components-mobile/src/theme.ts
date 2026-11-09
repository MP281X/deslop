import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#050706', light: '#f2f0e8'}),
	border: DynamicColorIOS({dark: '#283329', light: '#c7c9bc'}),
	card: DynamicColorIOS({dark: '#0d120e', light: '#fbfaf4'}),
	destructive: DynamicColorIOS({dark: '#ff5c5c', light: '#b3261e'}),
	foreground: DynamicColorIOS({dark: '#d9e2ce', light: '#11150f'}),
	mutedForeground: DynamicColorIOS({dark: '#7f8b78', light: '#62685c'}),
	primary: DynamicColorIOS({dark: '#b6ff3b', light: '#2f5d0b'}),
	primaryForeground: DynamicColorIOS({dark: '#071005', light: '#f2f0e8'}),
	surface: DynamicColorIOS({dark: '#0a0d0b', light: '#eceade'}),
	warning: DynamicColorIOS({dark: '#ffd166', light: '#6f5200'})
}

// Each app's primary tints its controls, live states and icon. Terminal Brutalist gives the suite one acid signal.
export const hues = {
	acid: DynamicColorIOS({dark: '#b6ff3b', light: '#2f5d0b'}),
	amber: DynamicColorIOS({dark: '#ffd166', light: '#6f5200'}),
	blue: DynamicColorIOS({dark: '#8fd3ff', light: '#1f5f7a'}),
	cyan: DynamicColorIOS({dark: '#b6ff3b', light: '#2f5d0b'}),
	ivory: DynamicColorIOS({dark: '#d9e2ce', light: '#4f5347'}),
	orange: DynamicColorIOS({dark: '#ffd166', light: '#8a5a00'}),
	pink: DynamicColorIOS({dark: '#ffd166', light: '#6f5200'}),
	purple: DynamicColorIOS({dark: '#d9e2ce', light: '#4f5347'}),
	slate: DynamicColorIOS({dark: '#d9e2ce', light: '#4f5347'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// A terminal is square: no row, sheet or tile is rounded.
export const radius = 0

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
