import {useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Cause} from 'effect'

import {Button, Host, Image, ProgressView, Text, VStack} from '@expo/ui/swift-ui'
import {
	background,
	buttonStyle,
	clipShape,
	controlSize,
	disabled,
	foregroundStyle,
	frame,
	lineLimit,
	padding,
	resizable,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import type {ReactNode} from 'react'

import type {Session} from '@deslop/runtime/mobile/session'

import {colors, mono} from './theme.ts'

import {assetAtom} from '#lib/utils.ts'

// The padding comes before the frame so the background behind it reaches every edge of the screen.
const FULL_SCREEN = [
	padding({all: 24}),
	frame({maxHeight: Infinity, maxWidth: Infinity}),
	background(colors.background)
]

export function LoadingScreen() {
	return (
		<Host style={{flex: 1}}>
			<ProgressView modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]} />
		</Host>
	)
}

// A failure thrown while rendering closes a React Native app, so its root reads the failure as a value and shows it here.
export function FailureScreen(props: {cause: Cause.Cause<unknown>; name: string; onRetry: () => void}) {
	return (
		<Host style={{flex: 1}}>
			<VStack spacing={12} modifiers={FULL_SCREEN}>
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>{props.name} hit an error</Text>
				<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(6)]}>
					{Cause.pretty(props.cause)}
				</Text>
				<Button
					onPress={() => props.onRetry()}
					modifiers={[buttonStyle('glassProminent'), tint(colors.primary), foregroundStyle(colors.primaryForeground)]}
				>
					<Text modifiers={[mono('headline', 16)]}>Try Again</Text>
				</Button>
			</VStack>
		</Host>
	)
}

// The app's icon in the middle of the screen and GitHub sign-in at the bottom.
function SignInScreen(props: {logo: number | string; onSignIn: () => void; waiting: boolean}) {
	return (
		<Host style={{flex: 1}}>
			<VStack spacing={20} modifiers={FULL_SCREEN}>
				<Image
					uiImage={useAtomSuspense(assetAtom(props.logo)).value}
					modifiers={[
						resizable(),
						frame({height: 64, width: 64}),
						clipShape('roundedRectangle', 14),
						frame({maxHeight: Infinity}),
						padding({bottom: 64})
					]}
				/>
				<Button
					onPress={() => props.onSignIn()}
					modifiers={[
						buttonStyle('glassProminent'),
						controlSize('large'),
						tint(colors.primary),
						foregroundStyle(colors.primaryForeground),
						disabled(props.waiting)
					]}
				>
					<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>Sign in with GitHub</Text>
				</Button>
			</VStack>
		</Host>
	)
}

// The app once its saved session exists, its sign-in screen until then.
export function SessionGate(props: {children: ReactNode; logo: number | string; session: Session}) {
	const send = useAtomSet(props.session.send)
	return (
		<>
			<MachineState machine={props.session} path="Reading" pending={<LoadingScreen />}>
				{() => <LoadingScreen />}
			</MachineState>
			<MachineState machine={props.session} path="SignedOut">
				{() => <SignInScreen logo={props.logo} onSignIn={() => send({_tag: 'SignIn'})} waiting={false} />}
			</MachineState>
			<MachineState machine={props.session} path="SigningIn">
				{() => <SignInScreen logo={props.logo} onSignIn={() => undefined} waiting />}
			</MachineState>
			<MachineState machine={props.session} path="SignedIn">
				{() => props.children}
			</MachineState>
		</>
	)
}
