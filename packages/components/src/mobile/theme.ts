import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// The shadcn theme of ../theme.css for SwiftUI views: zinc, an orange accent, square corners and JetBrains Mono.
// Each color follows the iPhone's light or dark appearance.
export const colors = {
	background: DynamicColorIOS({dark: '#111114', light: '#ffffff'}),
	border: DynamicColorIOS({dark: '#ffffff1f', light: '#e4e4e7'}),
	foreground: DynamicColorIOS({dark: '#f3f3f5', light: '#09090b'}),
	muted: DynamicColorIOS({dark: '#212124', light: '#f4f4f5'}),
	mutedForeground: DynamicColorIOS({dark: '#adadb5', light: '#71717b'}),
	primary: DynamicColorIOS({dark: '#e78a53', light: '#f54900'})
}

// JetBrains Mono at a base size that scales with Dynamic Type like the text style it stands in for. The app registers
// the font files, because a package cannot add fonts to an app bundle.
export function mono(textStyle: 'body' | 'caption' | 'footnote' | 'headline' | 'subheadline', size: number) {
	return font({family: textStyle === 'headline' ? 'JetBrainsMono-SemiBold' : 'JetBrainsMono-Regular', size, textStyle})
}
