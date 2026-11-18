import {useAtomMount, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Boolean, Function, Option, Predicate} from 'effect'

import {Host, Rectangle, Text, VStack} from '@expo/ui/swift-ui'
import {foregroundStyle, frame, padding} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {keychain} from '@deslop/runtime/mobile/keychain'
import type {Session} from '@deslop/runtime/mobile/session'
import {updateAtom} from '@deslop/runtime/mobile/updates'

import {colors, space} from '#components/theme.ts'
import {Button} from '#components/ui/button.tsx'

// judge-ignore no-unrelated-jobs -- The application gate owns both session admission and the update subscription, which must stay mounted even while sign-in blocks its children.
export function SessionGate(props: {children: ReactNode; session: Session}) {
	const account = useAtomValue(props.session.account)
	const signIn = useAtomSet(props.session.signIn)
	const signOut = useAtomSet(props.session.signOut)
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
	const needsSignIn = needsSignInCause(account.cause)
	const denied = isDeniedCause(account.cause)
	// A refused tailnet device has no saved session, so a sign-out there would only post a cookieless request; an expired session is a sign-in, not a refusal.
	const holdsSession = Option.exists(Option.liftThrowable(keychain.headers)(), headers =>
		Predicate.hasProperty(headers, 'cookie')
	)
	if (needsSignIn) {
		message.title = 'Sign in required'
		message.detail = 'This device is not on the tailnet.'
	} else if (denied) {
		message.title = 'Access denied'
		message.detail = 'This account cannot use the app.'
	}
	return (
		<Host style={{flex: 1}}>
			<VStack
				spacing={space[3]}
				modifiers={[padding({all: space[6]}), frame({maxHeight: Infinity, maxWidth: Infinity})]}
			>
				<Text>{message.title}</Text>
				<Text modifiers={[foregroundStyle(colors.mutedForeground)]}>{message.detail}</Text>
				{Boolean.match(needsSignIn, {
					onFalse: Function.constNull,
					onTrue: () => <Button onPress={() => signIn()}>Continue with GitHub</Button>
				})}
				{Boolean.match(denied && !needsSignIn && holdsSession, {
					onFalse: Function.constNull,
					onTrue: () => <Button onPress={() => signOut()}>Sign Out</Button>
				})}
			</VStack>
		</Host>
	)
}
