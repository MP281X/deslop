import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#0d0c0c', light: '#ffffff'}),
	border: DynamicColorIOS({dark: '#1a1a1a', light: '#e5e5e5'}),
	card: DynamicColorIOS({dark: '#141313', light: '#fafafa'}),
	destructive: DynamicColorIOS({dark: '#ff5d62', light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: '#dcdcdc', light: '#0a0a0a'}),
	mutedForeground: DynamicColorIOS({dark: '#8c8c8c', light: '#666666'}),
	primaryForeground: DynamicColorIOS({dark: '#0d0c0c', light: '#ffffff'}),
	warning: DynamicColorIOS({dark: '#ff9e3b', light: '#a3530b'})
}

// Each app's primary tints its controls, live states and icon.
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

// DESIGN.md's 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts.
export const text = {
	body: font({textStyle: 'subheadline'}),
	caption: font({textStyle: 'caption'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({textStyle: 'footnote'}),
	row: font({textStyle: 'subheadline', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
