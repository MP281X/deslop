import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#0a0a0a', light: '#faf9f6'}),
	border: DynamicColorIOS({dark: '#292929', light: '#e4e2dc'}),
	card: DynamicColorIOS({dark: '#131313', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#ff6868', light: '#a83434'}),
	foreground: DynamicColorIOS({dark: '#f4f4f1', light: '#111111'}),
	mutedForeground: DynamicColorIOS({dark: '#9b9b96', light: '#63635f'}),
	primaryForeground: DynamicColorIOS({dark: '#0a0a0a', light: '#faf9f6'}),
	surface: DynamicColorIOS({dark: '#101010', light: '#f3f1eb'}),
	warning: DynamicColorIOS({dark: '#d8b36a', light: '#7d6222'})
}

// Each app's primary tints its controls, live states and icon; the hues stay quiet beside the warm monochrome.
export const hues = {
	amber: DynamicColorIOS({dark: '#c7b184', light: '#776129'}),
	blue: DynamicColorIOS({dark: '#9aa8bd', light: '#4a5c78'}),
	cyan: DynamicColorIOS({dark: '#9fbdba', light: '#3f6f6c'}),
	ivory: DynamicColorIOS({dark: '#d6d2c8', light: '#686868'}),
	orange: DynamicColorIOS({dark: '#c9a17f', light: '#7f5426'}),
	pink: DynamicColorIOS({dark: '#c2a3aa', light: '#82495a'}),
	purple: DynamicColorIOS({dark: '#b3a9bf', light: '#615273'}),
	slate: DynamicColorIOS({dark: '#a5aab0', light: '#556072'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 16: 64}

// Concentric with the system's list rows, sheets and icon tiles.
export const radius = 16

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'caption'}),
	data: font({design: 'monospaced', textStyle: 'subheadline'}),
	detail: font({textStyle: 'subheadline'}),
	display: font({textStyle: 'largeTitle', weight: 'semibold'}),
	label: font({textStyle: 'caption', weight: 'semibold'}),
	monoCaption: font({design: 'monospaced', textStyle: 'caption'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'title3', weight: 'semibold'})
}
