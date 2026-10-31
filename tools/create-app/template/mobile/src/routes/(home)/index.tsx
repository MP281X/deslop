import {useAtomSuspense} from '@effect/atom-react'

import {Text} from '@expo/ui/swift-ui'
import {foregroundStyle, navigationTitle} from '@expo/ui/swift-ui/modifiers'

import {colors, text} from '@deslop/components-mobile/theme'

import {RpcClient} from '#lib/utils.ts'

export function HomeRoute() {
	return (
		<Text modifiers={[navigationTitle('template-app'), text.body, foregroundStyle(colors.foreground)]}>
			{useAtomSuspense(RpcClient.query('app.name', undefined)).value}
		</Text>
	)
}
