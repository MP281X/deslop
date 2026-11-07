import {useAtomMount} from '@effect/atom-react'

import {Host, NavigationStack, Text, Toolbar, ToolbarItem, VStack} from '@expo/ui/swift-ui'
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
import {AppTitle} from '@deslop/components-mobile/title'
import {updateAtom} from '@deslop/runtime/mobile'

import {primary} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import logo from '#routes/icon.png'

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Host style={{flex: 1}}>
			<NavigationStack modifiers={[tint(primary), background(colors.background)]}>
				<Toolbar modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline')]}>
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
					<Toolbar.Content>
						<ToolbarItem placement="principal">
							<AppTitle logo={logo} name="template-app" />
						</ToolbarItem>
					</Toolbar.Content>
				</Toolbar>
			</NavigationStack>
		</Host>
	)
}
