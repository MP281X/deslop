import {Boolean} from 'effect'

import {font} from '@expo/ui/swift-ui/modifiers'
import {DynamicColorIOS} from 'react-native'

// components-web's theme.css for SwiftUI views, in the iPhone's light or dark appearance.
export const colors = {
	background: DynamicColorIOS({dark: '#111114', light: '#ffffff'}),
	border: DynamicColorIOS({dark: '#ffffff1f', light: '#e4e4e7'}),
	destructive: DynamicColorIOS({dark: '#ff6467', light: '#e7000b'}),
	foreground: DynamicColorIOS({dark: '#f3f3f5', light: '#09090b'}),
	mutedForeground: DynamicColorIOS({dark: '#adadb5', light: '#71717b'}),
	primary: DynamicColorIOS({dark: '#e78a53', light: '#f54900'}),
	primaryForeground: DynamicColorIOS({dark: '#121113', light: '#fff7ed'})
}

// The app registers the JetBrains Mono files, because a package cannot add fonts to an app bundle.
export function mono(textStyle: 'body' | 'caption' | 'headline' | 'subheadline', size: number) {
	return font({
		family: Boolean.match(textStyle === 'headline', {
			onFalse: () => 'JetBrainsMono-Regular',
			onTrue: () => 'JetBrainsMono-SemiBold'
		}),
		size,
		textStyle
	})
}
