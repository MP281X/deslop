import {Host, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'

import {SessionGate} from '@deslop/components-mobile/blocks/session-gate'
import {colors} from '@deslop/components-mobile/theme'

import {session} from '#lib/session.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'

export function RootRoute() {
	return (
		<SessionGate session={session}>
			<Host style={{flex: 1}}>
				<NavigationStack modifiers={[tint(colors.foreground)]}>
					<HomeRoute />
				</NavigationStack>
			</Host>
		</SessionGate>
	)
}
