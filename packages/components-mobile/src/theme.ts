import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#0b0e14', light: '#f6f7fb'}),
	border: DynamicColorIOS({dark: '#1f2937', light: '#d8deea'}),
	card: DynamicColorIOS({dark: '#111722', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#f7768e', light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: '#d7deea', light: '#151b26'}),
	mutedForeground: DynamicColorIOS({dark: '#7f8ba0', light: '#5e6a7e'}),
	primaryForeground: DynamicColorIOS({dark: '#08101d', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#10141c', light: '#f0f3f8'}),
	warning: DynamicColorIOS({dark: '#e0af68', light: '#8f5a00'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#e0af68', light: '#91601d'}),
	blue: DynamicColorIOS({dark: '#7aa2f7', light: '#2f5fb3'}),
	cyan: DynamicColorIOS({dark: '#7dcfff', light: '#25777a'}),
	ivory: DynamicColorIOS({dark: '#c0caf5', light: '#686868'}),
	orange: DynamicColorIOS({dark: '#ff9e64', light: '#b64b11'}),
	pink: DynamicColorIOS({dark: '#e06c9f', light: '#a63c69'}),
	purple: DynamicColorIOS({dark: '#bb9af7', light: '#74519b'}),
	slate: DynamicColorIOS({dark: '#9aa5ce', light: '#526887'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// Concentric with the system's list rows, sheets and icon tiles.
export const radius = 8

// System fonts at Dynamic Type sizes: SF Pro for titles, SF Mono for every line of metadata.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'caption'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({design: 'monospaced', textStyle: 'footnote'}),
	display: font({textStyle: 'largeTitle', weight: 'bold'}),
	label: font({design: 'monospaced', textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
