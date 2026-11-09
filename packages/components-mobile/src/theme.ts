import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's native color boundary accepts sRGB, not OKLCH. These equivalents match theme.css in both appearances.
export const colors = {
	background: DynamicColorIOS({dark: '#07111f', light: '#eef4fa'}),
	border: DynamicColorIOS({dark: '#1b3a5b', light: '#b8c9d8'}),
	card: DynamicColorIOS({dark: '#0c1c30', light: '#ffffff'}),
	destructive: DynamicColorIOS({dark: '#ff6b6b', light: '#b42318'}),
	foreground: DynamicColorIOS({dark: '#dceaff', light: '#0b1d30'}),
	mutedForeground: DynamicColorIOS({dark: '#7fa6c8', light: '#526b80'}),
	primaryForeground: DynamicColorIOS({dark: '#03101d', light: '#ffffff'}),
	surface: DynamicColorIOS({dark: '#0a1728', light: '#e3edf5'}),
	warning: DynamicColorIOS({dark: '#ffb703', light: '#92400e'})
}

// Each app's primary tints its controls, live states and icon.
export const hues = {
	amber: DynamicColorIOS({dark: '#e9c46a', light: '#8a5a00'}),
	blue: DynamicColorIOS({dark: '#4895ef', light: '#2563a8'}),
	cyan: DynamicColorIOS({dark: '#4cc9f0', light: '#0b6f8a'}),
	ivory: DynamicColorIOS({dark: '#dceaff', light: '#52525b'}),
	orange: DynamicColorIOS({dark: '#f4a261', light: '#b45309'}),
	pink: DynamicColorIOS({dark: '#e88fb4', light: '#a23b67'}),
	purple: DynamicColorIOS({dark: '#9d8df1', light: '#6d4fa1'}),
	slate: DynamicColorIOS({dark: '#7fa6c8', light: '#4a6178'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 16: 64}

// Blueprint controls and sheets: 8pt corners, never a capsule.
export const radius = 8

// System fonts at Dynamic Type sizes: SF Pro for text, SF Mono for times, codes, counts and annotations.
export const text = {
	annotation: font({design: 'monospaced', textStyle: 'caption2', weight: 'medium'}),
	body: font({textStyle: 'body'}),
	caption: font({textStyle: 'caption'}),
	data: font({design: 'monospaced', textStyle: 'footnote'}),
	detail: font({textStyle: 'footnote'}),
	display: font({textStyle: 'largeTitle', weight: 'bold'}),
	label: font({textStyle: 'caption2', weight: 'semibold'}),
	row: font({textStyle: 'body', weight: 'semibold'}),
	title: font({textStyle: 'headline'})
}
