import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH; these match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#09090b', light: '#ffffff'}),
	border: DynamicColorIOS({dark: '#27272a', light: '#e4e4e7'}),
	card: DynamicColorIOS({dark: '#18181b', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#ff5d62', light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: '#fafafa', light: '#09090b'}),
	mutedForeground: DynamicColorIOS({dark: '#9f9fa9', light: '#71717b'}),
	primaryForeground: DynamicColorIOS({dark: '#09090b', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#18181b', light: '#fafafa'}),
	warning: DynamicColorIOS({dark: '#ff9e3b', light: '#a3530b'})
}

export const hues = {
	amber: DynamicColorIOS({dark: '#e6c384', light: '#91601d'}),
	blue: DynamicColorIOS({dark: '#7e9cd8', light: '#345dad'}),
	cyan: DynamicColorIOS({dark: '#a3d4d5', light: '#25777a'}),
	ivory: DynamicColorIOS({dark: '#dcd7ba', light: '#686868'}),
	orange: DynamicColorIOS({dark: '#ffa066', light: '#b64b11'}),
	pink: DynamicColorIOS({dark: '#d27e99', light: '#a63c69'}),
	purple: DynamicColorIOS({dark: '#957fb8', light: '#74519b'}),
	slate: DynamicColorIOS({dark: '#9cabca', light: '#526887'})
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
