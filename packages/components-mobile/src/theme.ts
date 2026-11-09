import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#0f1519', light: '#f7fafb'}),
	border: DynamicColorIOS({dark: '#2a373f', light: '#d9e3e8'}),
	card: DynamicColorIOS({dark: '#182229', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#d97a7a', light: '#b05252'}),
	foreground: DynamicColorIOS({dark: '#e6eef2', light: '#122027'}),
	mutedForeground: DynamicColorIOS({dark: '#93a4ae', light: '#5e707a'}),
	primaryForeground: DynamicColorIOS({dark: '#0c151a', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#151d22', light: '#f2f6f7'}),
	warning: DynamicColorIOS({dark: '#d9b26e', light: '#866326'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#d9b26e', light: '#866326'}),
	blue: DynamicColorIOS({dark: '#9ec5d8', light: '#3c748c'}),
	cyan: DynamicColorIOS({dark: '#99c0c8', light: '#3d7079'}),
	ivory: DynamicColorIOS({dark: '#b9c3c8', light: '#5f6b72'}),
	orange: DynamicColorIOS({dark: '#c99274', light: '#a25f3e'}),
	pink: DynamicColorIOS({dark: '#c99bb2', light: '#8e5b71'}),
	purple: DynamicColorIOS({dark: '#b4a8cc', light: '#6b6189'}),
	slate: DynamicColorIOS({dark: '#9fb3bf', light: '#526570'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48}

// Concentric with the system's list rows, sheets and icon tiles.
export const radius = 14

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts. Detail and labels step up one size so metadata stays legible at a glance.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'footnote'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({textStyle: 'subheadline'}),
	display: font({textStyle: 'largeTitle', weight: 'bold'}),
	label: font({textStyle: 'footnote', weight: 'medium'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
