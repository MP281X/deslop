import {useAtomRefresh, useAtomSuspense} from '@effect/atom-react'

import {Text} from '@expo/ui/swift-ui'
import {foregroundStyle} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {FailureContent} from '@deslop/components-mobile/screens'
import {colors, text} from '@deslop/components-mobile/theme'

import {RpcClient} from '#lib/utils.ts'

export function HomeRoute() {
	const atom = RpcClient.query('app.name', undefined)
	const loaded = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	if (AsyncResult.isFailure(loaded)) {
		return <FailureContent cause={loaded.cause} name="template-app" onRetry={refresh} />
	}
	return <Text modifiers={[text.body, foregroundStyle(colors.foreground)]}>{loaded.value}</Text>
}
