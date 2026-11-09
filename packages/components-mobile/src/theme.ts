import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#0e0e0e', light: '#f7f7f4'}),
	border: DynamicColorIOS({dark: '#2e2e2e', light: '#d9d9d4'}),
	card: DynamicColorIOS({dark: '#171717', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#ff3b30', light: '#d92f26'}),
	foreground: DynamicColorIOS({dark: '#fafaf7', light: '#0e0e0e'}),
	mutedForeground: DynamicColorIOS({dark: '#a4a4a0', light: '#6f6f6a'}),
	primary: DynamicColorIOS({dark: '#ff3b30', light: '#d92f26'}),
	primaryForeground: DynamicColorIOS({dark: '#ffffff', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#141414', light: '#f0f0eb'}),
	warning: DynamicColorIOS({dark: '#f0b429', light: '#8a5a00'})
}

// Each app's identity tint: black, white and the signal, never a rainbow.
export const hues = {
	amber: DynamicColorIOS({dark: '#f0b429', light: '#8a5a00'}),
	blue: DynamicColorIOS({dark: '#fafaf7', light: '#0e0e0e'}),
	cyan: DynamicColorIOS({dark: '#8fbf9f', light: '#2f6b4f'}),
	ivory: DynamicColorIOS({dark: '#fafaf7', light: '#4a4a46'}),
	orange: DynamicColorIOS({dark: '#ff3b30', light: '#d92f26'}),
	pink: DynamicColorIOS({dark: '#ff3b30', light: '#d92f26'}),
	purple: DynamicColorIOS({dark: '#6e6e6a', light: '#55554f'}),
	slate: DynamicColorIOS({dark: '#a4a4a0', light: '#6f6f6a'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// Swiss Signal is square: the system's list rows, sheets and icon tiles take no radius.
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
	title: font({textStyle: 'headline', weight: 'semibold'})
}
