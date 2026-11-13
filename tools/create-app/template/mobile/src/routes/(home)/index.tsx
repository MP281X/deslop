import {Text, Toolbar, VStack} from '@expo/ui/swift-ui'
import {
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	redacted
} from '@expo/ui/swift-ui/modifiers'
import {Suspense} from 'react'

import {Loaded} from '@deslop/components-mobile/screens'
import {colors, text} from '@deslop/components-mobile/theme'

import {nameAtom} from '#lib/session.ts'

export function HomeRoute() {
	return (
		<Toolbar modifiers={[navigationTitle('template-app'), navigationBarTitleDisplayMode('large')]}>
			<VStack modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity})]}>
				<Suspense
					fallback={
						<Text modifiers={[text.body, foregroundStyle(colors.foreground), redacted('placeholder')]}>
							@deslop/template-app
						</Text>
					}
				>
					<Loaded atom={nameAtom} name="template-app">
						{name => <Text modifiers={[text.body, foregroundStyle(colors.foreground)]}>{name}</Text>}
					</Loaded>
				</Suspense>
			</VStack>
		</Toolbar>
	)
}
