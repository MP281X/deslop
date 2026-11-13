import {Host, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'

import {SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'

import {primary, session} from '#lib/session.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import logo from '#routes/icon.png'

export function RootRoute() {
	return (
		<SessionGate logo={logo} session={session} tint={primary}>
			<Host style={{flex: 1}}>
				<NavigationStack modifiers={[tint(colors.foreground)]}>
					<HomeRoute />
				</NavigationStack>
			</Host>
		</SessionGate>
	)
}
