import {useAtomMount, useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Result} from 'effect'

import {Button, Host, Image, Rectangle, Spacer, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	buttonBorderShape,
	buttonStyle,
	clipShape,
	controlSize,
	disabled,
	font,
	foregroundStyle,
	frame,
	imageScale,
	padding,
	resizable,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {isDenied} from '@deslop/runtime/auth/utils'
import {updateAtom} from '@deslop/runtime/mobile'
import type {Session} from '@deslop/runtime/mobile/session'

import {colors, radius, space, text} from './theme.ts'

import {assetAtom} from '#lib/utils.ts'

// The padding comes before the frame so content stays inside the safe area while the screen fills every edge.
const FULL_SCREEN = [padding({all: space[6]}), frame({maxHeight: Infinity, maxWidth: Infinity})]

// Reading the saved session is local and takes milliseconds, so it shows the empty screen rather than a skeleton that blinks.
function BlankScreen() {
	return (
		<Host style={{flex: 1}}>
			<Rectangle modifiers={[foregroundStyle(colors.background)]} />
		</Host>
	)
}

function deniedBy(cause: Cause.Cause<unknown>) {
	return Array.some(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))
}

export function shownOf<A, E>(result: AsyncResult.Failure<A, E> | AsyncResult.Success<A, E>) {
	if (AsyncResult.isSuccess(result)) return Result.succeed(result.value)
	if (deniedBy(result.cause)) return Result.fail(result.cause)
	return Result.fromOption(AsyncResult.value(result), () => result.cause)
}

// A blocking failure is one destructive button carrying its reason; a denial is a lock with no retry.
export function FailureContent(props: {cause: Cause.Cause<unknown>; name: string; onRetry: () => void}) {
	return (
		<VStack spacing={space[6]} modifiers={FULL_SCREEN}>
			{Boolean.match(deniedBy(props.cause), {
				onFalse: () => (
					<Button
						label={`Can’t Reach ${props.name}`}
						systemImage="arrow.clockwise"
						role="destructive"
						onPress={props.onRetry}
						modifiers={[
							buttonStyle('glassProminent'),
							buttonBorderShape('capsule'),
							controlSize('large'),
							tint(colors.destructive)
						]}
					/>
				),
				onTrue: () => (
					<Image
						systemName="lock"
						modifiers={[
							font({textStyle: 'largeTitle'}),
							imageScale('large'),
							foregroundStyle(colors.foreground),
							accessibilityLabel('You don’t have access')
						]}
					/>
				)
			})}
		</VStack>
	)
}

// The app's mark and GitHub sign-in at the bottom.
function SignInScreen(props: {logo: number | string; onSignIn: () => void; tint: ColorValue; waiting: boolean}) {
	return (
		<Host style={{flex: 1}}>
			<VStack spacing={space[6]} modifiers={FULL_SCREEN}>
				<Spacer />
				<Image
					uiImage={useAtomSuspense(assetAtom(props.logo)).value}
					modifiers={[resizable(), frame({height: 64, width: 64}), clipShape('roundedRectangle', radius)]}
				/>
				<Spacer />
				<Button
					onPress={() => props.onSignIn()}
					modifiers={[
						buttonStyle('glassProminent'),
						buttonBorderShape('capsule'),
						controlSize('large'),
						tint(props.tint),
						disabled(props.waiting)
					]}
				>
					<Text modifiers={[text.title]}>
						{Boolean.match(props.waiting, {onFalse: () => 'Sign in with GitHub', onTrue: () => 'Signing In…'})}
					</Text>
				</Button>
			</VStack>
		</Host>
	)
}

export function SessionGate(props: {children: ReactNode; logo: number | string; session: Session; tint: ColorValue}) {
	const send = useAtomSet(props.session.send)
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<MachineState machine={props.session} path="Reading" pending={<BlankScreen />}>
				{() => <BlankScreen />}
			</MachineState>
			<MachineState machine={props.session} path="SignedOut">
				{() => (
					<SignInScreen logo={props.logo} onSignIn={() => send({_tag: 'SignIn'})} tint={props.tint} waiting={false} />
				)}
			</MachineState>
			<MachineState machine={props.session} path="SigningIn">
				{() => <SignInScreen logo={props.logo} onSignIn={() => undefined} tint={props.tint} waiting />}
			</MachineState>
			<MachineState machine={props.session} path="SignedIn">
				{() => props.children}
			</MachineState>
		</Suspense>
	)
}
