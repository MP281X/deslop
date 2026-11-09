import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#171512', light: '#eee7da'}),
	border: DynamicColorIOS({dark: '#4a4238', light: '#c7bba8'}),
	card: DynamicColorIOS({dark: '#24201b', light: '#f8f2e7'}),
	destructive: DynamicColorIOS({dark: '#e4572e', light: '#a83224'}),
	foreground: DynamicColorIOS({dark: '#f2e9db', light: '#211c16'}),
	mutedForeground: DynamicColorIOS({dark: '#b8ab99', light: '#6f6355'}),
	primaryForeground: DynamicColorIOS({dark: '#1a1209', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#1e1b17', light: '#e7ddcb'}),
	warning: DynamicColorIOS({dark: '#e0a83c', light: '#7d5510'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#e0a83c', light: '#7d5510'}),
	blue: DynamicColorIOS({dark: '#8fa6bd', light: '#455d75'}),
	cyan: DynamicColorIOS({dark: '#7fa9a0', light: '#356b66'}),
	ivory: DynamicColorIOS({dark: '#e8d9c1', light: '#5f5545'}),
	orange: DynamicColorIOS({dark: '#ff7a1a', light: '#c4530a'}),
	pink: DynamicColorIOS({dark: '#d99a90', light: '#8f4740'}),
	purple: DynamicColorIOS({dark: '#b292b8', light: '#6b4f70'}),
	slate: DynamicColorIOS({dark: '#cbb399', light: '#6e5b43'})
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
	label: font({design: 'monospaced', textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
