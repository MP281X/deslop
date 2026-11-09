import {useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Result} from 'effect'

import {Button, Host, Image, Label, Rectangle, Spacer, Text, VStack} from '@expo/ui/swift-ui'
import {
	background,
	buttonBorderShape,
	buttonStyle,
	clipShape,
	controlSize,
	disabled,
	foregroundStyle,
	frame,
	labelStyle,
	multilineTextAlignment,
	padding,
	resizable,
	shapes,
	strokeBorder,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {isDenied} from '@deslop/runtime/auth/utils'
import type {Session} from '@deslop/runtime/mobile/session'

import {colors, radius, space, text} from './theme.ts'

import {assetAtom} from '#lib/utils.ts'

// The padding comes before the frame so content stays inside the safe area while the screen fills every edge.
const FULL_SCREEN = [padding({all: space[6]}), frame({maxHeight: Infinity, maxWidth: Infinity})]

// Reading the saved session is local and takes milliseconds, so it shows the empty screen rather than a skeleton that blinks.
export function BlankScreen() {
	return (
		<Host style={{flex: 1}}>
			<Rectangle modifiers={[foregroundStyle(colors.background)]} />
		</Host>
	)
}

function deniedBy(cause: Cause.Cause<unknown>) {
	return Array.some(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))
}

// What a reader shows: its value, kept through an ordinary outage, or the failure that blocks it when nothing has loaded or access was refused.
export function shownOf<A, E>(result: AsyncResult.Failure<A, E> | AsyncResult.Success<A, E>) {
	if (AsyncResult.isSuccess(result)) return Result.succeed(result.value)
	if (deniedBy(result.cause)) return Result.fail(result.cause)
	return Result.fromOption(AsyncResult.value(result), () => result.cause)
}

// Retry takes the destructive hue of the failure it answers, not the app's accent.
export function FailureContent(props: {cause: Cause.Cause<unknown>; name: string; onRetry: () => void}) {
	const denied = deniedBy(props.cause)
	return (
		<VStack spacing={space[6]} modifiers={FULL_SCREEN}>
			<VStack
				spacing={space[3]}
				modifiers={[
					padding({all: space[6]}),
					background(colors.card),
					clipShape('roundedRectangle', radius),
					strokeBorder({content: colors.border, cornerRadius: radius, shape: 'roundedRectangle', style: {lineWidth: 2}})
				]}
			>
				<Label
					icon={
						<Image
							systemName={Boolean.match(denied, {onFalse: () => 'exclamationmark.circle', onTrue: () => 'lock'})}
							modifiers={[text.body, foregroundStyle(colors.destructive)]}
						/>
					}
					modifiers={[labelStyle('titleAndIcon')]}
				>
					<Text modifiers={[text.body, foregroundStyle(colors.foreground), multilineTextAlignment('center')]}>
						{Boolean.match(denied, {
							onFalse: () => `${props.name} unavailable.`,
							onTrue: () => 'You don’t have access.'
						})}
					</Text>
				</Label>
				<Button
					label="Retry"
					role="destructive"
					onPress={props.onRetry}
					modifiers={[
						buttonStyle('borderedProminent'),
						buttonBorderShape('roundedRectangle', radius),
						controlSize('regular'),
						frame({minHeight: 48}),
						tint(colors.destructive)
					]}
				/>
			</VStack>
		</VStack>
	)
}

// The app's icon and a short statement in the middle of the screen, with GitHub sign-in at the bottom.
function SignInScreen(props: {logo: number | string; onSignIn: () => void; tint: ColorValue; waiting: boolean}) {
	return (
		<Host style={{flex: 1}}>
			<VStack spacing={space[6]} modifiers={FULL_SCREEN}>
				<Spacer />
				<Image
					uiImage={useAtomSuspense(assetAtom(props.logo)).value}
					modifiers={[
						resizable(),
						frame({height: 64, width: 64}),
						clipShape('roundedRectangle', radius),
						strokeBorder({
							content: colors.border,
							cornerRadius: radius,
							shape: 'roundedRectangle',
							style: {lineWidth: 2}
						})
					]}
				/>
				<Text modifiers={[text.label, foregroundStyle(colors.mutedForeground)]}>DESLOP SESSION</Text>
				<Text modifiers={[text.body, foregroundStyle(colors.mutedForeground), multilineTextAlignment('center')]}>
					Sign in with GitHub to keep this app in sync.
				</Text>
				<Spacer />
				<Button
					onPress={() => props.onSignIn()}
					modifiers={[
						buttonStyle('plain'),
						frame({minHeight: 48}),
						padding({horizontal: space[6], vertical: space[3]}),
						background(props.tint, shapes.roundedRectangle({cornerRadius: radius})),
						clipShape('roundedRectangle', radius),
						strokeBorder({
							content: colors.border,
							cornerRadius: radius,
							shape: 'roundedRectangle',
							style: {lineWidth: 2}
						}),
						disabled(props.waiting)
					]}
				>
					<Text modifiers={[text.title, foregroundStyle(colors.primaryForeground)]}>
						{Boolean.match(props.waiting, {onFalse: () => 'Sign in with GitHub', onTrue: () => 'Signing In…'})}
					</Text>
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
