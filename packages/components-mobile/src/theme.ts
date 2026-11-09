import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#121110', light: '#ece8e0'}),
	border: DynamicColorIOS({dark: '#4a453e', light: '#35312b'}),
	card: DynamicColorIOS({dark: '#201e1b', light: '#f6f2ea'}),
	destructive: DynamicColorIOS({dark: '#ff5c5c', light: '#b83333'}),
	foreground: DynamicColorIOS({dark: '#efe9df', light: '#171512'}),
	mutedForeground: DynamicColorIOS({dark: '#b1a89b', light: '#6a6358'}),
	primaryForeground: DynamicColorIOS({dark: '#141210', light: '#f6f2ea'}),
	surface: DynamicColorIOS({dark: '#191816', light: '#e5e0d7'}),
	warning: DynamicColorIOS({dark: '#d9a441', light: '#8a5a12'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#e6c384', light: '#91601d'}),
	blue: DynamicColorIOS({dark: '#7e9cd8', light: '#345dad'}),
	cyan: DynamicColorIOS({dark: '#a3d4d5', light: '#25777a'}),
	ivory: DynamicColorIOS({dark: '#dcd7ba', light: '#686868'}),
	orange: DynamicColorIOS({dark: '#ff5c35', light: '#b64b11'}),
	pink: DynamicColorIOS({dark: '#d27e99', light: '#a63c69'}),
	purple: DynamicColorIOS({dark: '#957fb8', light: '#74519b'}),
	slate: DynamicColorIOS({dark: '#9cabca', light: '#526887'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// Concrete keeps square edges: rows, tiles and sheets have no corner radius.

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes and counts.
export const text = {
	body: font({textStyle: 'body'}),
	caption: font({design: 'monospaced', textStyle: 'caption2'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({textStyle: 'footnote'}),
	display: font({textStyle: 'largeTitle', weight: 'black'}),
	label: font({design: 'monospaced', textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline', weight: 'semibold'})
}
