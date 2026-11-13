import {Text} from '@expo/ui/swift-ui'
import {foregroundStyle} from '@expo/ui/swift-ui/modifiers'

import {Loaded} from '@deslop/components-mobile/screens'
import {colors, text} from '@deslop/components-mobile/theme'

import {RpcClient} from '#lib/utils.ts'

export function HomeRoute() {
	return (
		<Loaded atom={RpcClient.query('app.name', undefined)} name="template-app">
			{name => <Text modifiers={[text.body, foregroundStyle(colors.foreground)]}>{name}</Text>}
		</Loaded>
	)
}
