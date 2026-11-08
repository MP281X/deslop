import {useAtomMount} from '@effect/atom-react'

import {Host, NavigationStack, Text, Toolbar, VStack} from '@expo/ui/swift-ui'
import {
	background,
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	redacted,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {Suspense} from 'react'

import {colors, text} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {primary} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Host style={{flex: 1}}>
			<NavigationStack modifiers={[tint(primary), background(colors.background)]}>
				<Toolbar modifiers={[navigationTitle('template-app'), navigationBarTitleDisplayMode('large')]}>
					<VStack modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity})]}>
						<Suspense
							fallback={
								<Text modifiers={[text.body, foregroundStyle(colors.foreground), redacted('placeholder')]}>
									@deslop/template-app
								</Text>
							}
						>
							<HomeRoute />
						</Suspense>
					</VStack>
				</Toolbar>
			</NavigationStack>
		</Host>
	)
}
