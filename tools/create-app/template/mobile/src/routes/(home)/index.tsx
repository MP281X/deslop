import {useAtomSuspense} from '@effect/atom-react'

import {Text} from '@expo/ui/swift-ui'
import {foregroundStyle, navigationTitle} from '@expo/ui/swift-ui/modifiers'

import {RpcClient} from '#lib/utils.ts'
import {colors, mono} from '@deslop/components-mobile/theme'

export function HomeRoute() {
	return (
		<Text modifiers={[navigationTitle('template-app'), mono('body', 15), foregroundStyle(colors.foreground)]}>
			{useAtomSuspense(RpcClient.query('app.name', undefined)).value}
		</Text>
	)
}
