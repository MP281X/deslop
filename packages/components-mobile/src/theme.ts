import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// Expo's color boundary takes sRGB not OKLCH; these match theme.css, and translucent card, surface and border act as native glass.
export const colors = {
	background: DynamicColorIOS({dark: '#070b13', light: '#f2f6fb'}),
	border: DynamicColorIOS({dark: 'rgba(164, 194, 230, 0.18)', light: '#cfdae8'}),
	card: DynamicColorIOS({dark: 'rgba(18, 28, 44, 0.62)', light: 'rgba(255, 255, 255, 0.75)'}),
	destructive: DynamicColorIOS({dark: '#ff6b8a', light: '#c92b38'}),
	foreground: DynamicColorIOS({dark: '#eaf2ff', light: '#0b1523'}),
	mutedForeground: DynamicColorIOS({dark: '#8fa3be', light: '#5f7186'}),
	primaryForeground: DynamicColorIOS({dark: '#041018', light: '#ffffff'}),
	success: DynamicColorIOS({dark: '#34d399', light: '#157a55'}),
	surface: DynamicColorIOS({dark: 'rgba(16, 24, 38, 0.72)', light: 'rgba(255, 255, 255, 0.6)'}),
	warning: DynamicColorIOS({dark: '#ffc857', light: '#a3530b'})
}

// Each app's primary tints its controls and icon; status keeps the spectral identity.
export const hues = {
	amber: DynamicColorIOS({dark: '#34d399', light: '#157a55'}),
	blue: DynamicColorIOS({dark: '#a78bfa', light: '#2f66c9'}),
	cyan: DynamicColorIOS({dark: '#5eebff', light: '#087f9c'}),
	ivory: DynamicColorIOS({dark: '#c3d2e6', light: '#5c7089'}),
	orange: DynamicColorIOS({dark: '#ffc857', light: '#a3530b'}),
	pink: DynamicColorIOS({dark: '#f472b6', light: '#b0336c'}),
	purple: DynamicColorIOS({dark: '#a78bfa', light: '#6d4fc4'}),
	slate: DynamicColorIOS({dark: '#9fb3cc', light: '#526887'})
}

// The 4px spacing steps, named as Tailwind names them on the web: `space[3]` is `gap-3`, 12pt.
export const space = {1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 16: 64}

// Concentric with the system's sheets, floating rows and icon tiles: 16pt cards, 10pt controls.
export const radius = 16

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
