import {useAtomMount, useAtomValue} from '@effect/atom-react'

import {Host, Rectangle, Text, VStack} from '@expo/ui/swift-ui'
import {foregroundStyle, frame, padding} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {isDeniedCause} from '@deslop/runtime/client/live-stream'
import type {Session} from '@deslop/runtime/mobile/session'
import {updateAtom} from '@deslop/runtime/mobile/updates'

import {colors, space} from '#components/theme.ts'

export function SessionGate(props: {children: ReactNode; session: Session}) {
	const account = useAtomValue(props.session.account)
	useAtomMount(updateAtom)
	if (AsyncResult.isSuccess(account)) return props.children
	if (AsyncResult.isInitial(account)) {
		return (
			<Host style={{flex: 1}}>
				<Rectangle modifiers={[foregroundStyle(colors.background)]} />
			</Host>
		)
	}
	const message = {detail: 'Return to the app to try again.', title: 'Could not reach the server'}
	if (isDeniedCause(account.cause)) {
		message.title = 'Connect to Tailscale'
		message.detail = 'Return to the app after connecting to try again.'
	}
	return (
		<Host style={{flex: 1}}>
			<VStack
				spacing={space[3]}
				modifiers={[padding({all: space[6]}), frame({maxHeight: Infinity, maxWidth: Infinity})]}
			>
				<Text>{message.title}</Text>
				<Text modifiers={[foregroundStyle(colors.mutedForeground)]}>{message.detail}</Text>
			</VStack>
		</Host>
	)
}
