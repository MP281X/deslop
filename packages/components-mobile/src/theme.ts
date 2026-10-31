import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// DESIGN.md owns these values, in the iPhone's light or dark appearance; theme.test.ts fails when they drift.
export const colors = {
	background: DynamicColorIOS({dark: '#0a0a0a', light: '#ffffff'}),
	border: DynamicColorIOS({dark: '#222222', light: '#e5e5e5'}),
	card: DynamicColorIOS({dark: '#111111', light: '#fafafa'}),
	destructive: DynamicColorIOS({dark: '#d14d41', light: '#af3029'}),
	foreground: DynamicColorIOS({dark: '#ededed', light: '#0a0a0a'}),
	mutedForeground: DynamicColorIOS({dark: '#9a9a9a', light: '#666666'}),
	primaryForeground: DynamicColorIOS({dark: '#0a0a0a', light: '#ffffff'}),
	warning: DynamicColorIOS({dark: '#d0a215', light: '#ad8301'})
}

// Each app's primary is one of these hues, named in DESIGN.md; it tints the app's controls, live states and icon.
export const hues = {
	blue: DynamicColorIOS({dark: '#4385be', light: '#205ea6'}),
	orange: DynamicColorIOS({dark: '#da702c', light: '#bc5215'}),
	yellow: DynamicColorIOS({dark: '#d0a215', light: '#ad8301'})
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
