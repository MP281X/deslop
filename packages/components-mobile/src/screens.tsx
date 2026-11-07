import {useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause} from 'effect'

import {Button, Host, Image, Rectangle, Text, VStack} from '@expo/ui/swift-ui'
import {
	background,
	buttonStyle,
	clipShape,
	controlSize,
	disabled,
	foregroundStyle,
	frame,
	padding,
	resizable,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import type {ComponentProps, ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {isDenied} from '@deslop/runtime/auth/utils'
import type {Session} from '@deslop/runtime/mobile/session'

import {colors, radius, space, text} from './theme.ts'

import {Problem} from '#components/problem.tsx'
import {ItemGroupSkeleton} from '#components/ui/skeleton.tsx'
import {assetAtom} from '#lib/utils.ts'

// The padding comes before the frame so the background behind it reaches every edge of the screen.
const FULL_SCREEN = [
	padding({all: space[6]}),
	frame({maxHeight: Infinity, maxWidth: Infinity}),
	background(colors.background)
]

// Reading the saved session is local and takes milliseconds, so it shows the empty screen rather than a skeleton that blinks.
export function BlankScreen() {
	return (
		<Host style={{flex: 1}}>
			<Rectangle modifiers={[foregroundStyle(colors.background)]} />
		</Host>
	)
}

// Data on its way, shaped like the list it will fill.
export function LoadingScreen() {
	return (
		<Host style={{flex: 1}}>
			<ItemGroupSkeleton rows={10} />
		</Host>
	)
}

export function FailureContent(props: {cause: Cause.Cause<unknown>; name: string; onRetry: () => void}) {
	return (
		<VStack modifiers={FULL_SCREEN}>
			<Problem
				label={Boolean.match(
					Array.some(props.cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error)),
					{onFalse: () => `${props.name} unavailable`, onTrue: () => 'Access denied'}
				)}
				onRetry={props.onRetry}
			/>
		</VStack>
	)
}

// A root owns its Host; a reader already inside native navigation uses FailureContent.
export function FailureScreen(props: ComponentProps<typeof FailureContent>) {
	return (
		<Host style={{flex: 1}}>
			<FailureContent {...props} />
		</Host>
	)
}

// The app's icon in the middle of the screen and GitHub sign-in at the bottom.
function SignInScreen(props: {logo: number | string; onSignIn: () => void; tint: ColorValue; waiting: boolean}) {
	return (
		<Host style={{flex: 1}}>
			<VStack spacing={space[6]} modifiers={FULL_SCREEN}>
				<Image
					uiImage={useAtomSuspense(assetAtom(props.logo)).value}
					modifiers={[
						resizable(),
						frame({height: 64, width: 64}),
						clipShape('roundedRectangle', radius),
						frame({maxHeight: Infinity}),
						padding({bottom: space[16]})
					]}
				/>
				<Button
					onPress={() => props.onSignIn()}
					modifiers={[
						buttonStyle('glassProminent'),
						controlSize('large'),
						tint(props.tint),
						foregroundStyle(colors.primaryForeground),
						disabled(props.waiting)
					]}
				>
					<Text modifiers={[text.title, frame({maxWidth: Infinity})]}>Sign in with GitHub</Text>
				</Button>
			</VStack>
		</Host>
	)
}

// The app once its saved session exists, its sign-in screen until then.
export function SessionGate(props: {children: ReactNode; logo: number | string; session: Session; tint: ColorValue}) {
	const send = useAtomSet(props.session.send)
	return (
		<>
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
		</>
	)
}
