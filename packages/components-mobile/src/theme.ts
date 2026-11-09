import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#08090a', light: '#fbfbfc'}),
	border: DynamicColorIOS({dark: '#25282e', light: '#e7e8eb'}),
	card: DynamicColorIOS({dark: '#121417', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#f2555a', light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: '#f7f8f8', light: '#17181b'}),
	mutedForeground: DynamicColorIOS({dark: '#8a8f98', light: '#6b7079'}),
	primaryForeground: DynamicColorIOS({dark: '#ffffff', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#0e1012', light: '#f4f5f7'}),
	warning: DynamicColorIOS({dark: '#f2c94c', light: '#a3530b'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#f2c94c', light: '#91601d'}),
	blue: DynamicColorIOS({dark: '#5e6ad2', light: '#345dad'}),
	cyan: DynamicColorIOS({dark: '#5fb3c9', light: '#25777a'}),
	ivory: DynamicColorIOS({dark: '#c9ccd1', light: '#686868'}),
	orange: DynamicColorIOS({dark: '#e08a5b', light: '#b64b11'}),
	pink: DynamicColorIOS({dark: '#c77fa8', light: '#a63c69'}),
	purple: DynamicColorIOS({dark: '#7c5cff', light: '#5e42d6'}),
	slate: DynamicColorIOS({dark: '#8a8f98', light: '#526887'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 16: 64}

// Concentric with the system's list rows, sheets and icon tiles; Linear's 10pt native corner.
export const radius = 10

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'caption2'}),
	data: font({design: 'monospaced', textStyle: 'caption'}),
	detail: font({textStyle: 'footnote'}),
	display: font({textStyle: 'largeTitle', weight: 'bold'}),
	label: font({textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'subheadline', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
