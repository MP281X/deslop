import {useAtomMount} from '@effect/atom-react'

import {Host, NavigationStack, ProgressView} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense} from 'react'

import {colors} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {HomeRoute} from '#routes/(home)/index.tsx'

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The SwiftUI host is a React Native view and fills the screen through its style.
		<Host style={{flex: 1}}>
			<NavigationStack modifiers={[tint(colors.foreground), background(colors.background)]}>
				<Suspense fallback={<ProgressView />}>
					<HomeRoute />
				</Suspense>
			</NavigationStack>
		</Host>
	)
}
