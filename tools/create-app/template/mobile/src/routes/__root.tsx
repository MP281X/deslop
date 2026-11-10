import {useAtomMount} from '@effect/atom-react'

import {Host, NavigationStack, Text, Toolbar, VStack} from '@expo/ui/swift-ui'
import {
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	redacted,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {Suspense} from 'react'

import {BlankScreen, SessionGate} from '@deslop/components-mobile/screens'
import {colors, text} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {primary, session} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import logo from '#routes/icon.png'

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<SessionGate logo={logo} session={session.machine} tint={primary}>
				<Host style={{flex: 1}}>
					<NavigationStack modifiers={[tint(primary)]}>
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
			</SessionGate>
		</Suspense>
	)
}
