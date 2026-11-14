import {useAtomMount, useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Function} from 'effect'

import {Host, Image, Rectangle, Spacer, VStack} from '@expo/ui/swift-ui'
import {clipShape, foregroundStyle, frame, padding, resizable, tint} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import {Suspense} from 'react'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import type {Session} from '@deslop/runtime/mobile/session'
import {updateAtom} from '@deslop/runtime/mobile/updates'

import {colors, radius, space} from '#components/theme.ts'
import {Button} from '#components/ui/button.tsx'
import {assetAtom} from '#lib/images.ts'

// Reading the saved session is local and takes milliseconds, so it shows the empty screen rather than a skeleton that blinks.
function BlankScreen() {
	return (
		<Host style={{flex: 1}}>
			<Rectangle modifiers={[foregroundStyle(colors.background)]} />
		</Host>
	)
}

// The app's mark and the sign-in at the bottom, which opens Auth's own page with every way in.
function SignInScreen(props: {logo: number | string; onSignIn: () => void; tint: ColorValue; waiting: boolean}) {
	return (
		<Host style={{flex: 1}}>
			{/* The padding comes before the frame so content stays inside the safe area while the screen fills every edge. */}
			<VStack
				spacing={space[6]}
				modifiers={[padding({all: space[6]}), frame({maxHeight: Infinity, maxWidth: Infinity})]}
			>
				<Spacer />
				<Image
					uiImage={useAtomSuspense(assetAtom(props.logo)).value}
					modifiers={[resizable(), frame({height: 64, width: 64}), clipShape('roundedRectangle', radius)]}
				/>
				<Spacer />
				<Button size="lg" disabled={props.waiting} onPress={props.onSignIn} modifiers={[tint(props.tint)]}>
					Sign In
				</Button>
			</VStack>
		</Host>
	)
}

export function SessionGate(props: {children: ReactNode; logo: number | string; session: Session; tint: ColorValue}) {
	const send = useAtomSet(props.session.machine.send)
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<MachineState machine={props.session.machine} path="Reading" pending={<BlankScreen />}>
				{() => <BlankScreen />}
			</MachineState>
			<MachineState machine={props.session.machine} path="SignedOut">
				{() => (
					<SignInScreen
						logo={props.logo}
						onSignIn={() => send(props.session.events.SignIn())}
						tint={props.tint}
						waiting={false}
					/>
				)}
			</MachineState>
			<MachineState machine={props.session.machine} path="SigningIn">
				{() => <SignInScreen logo={props.logo} onSignIn={Function.constUndefined} tint={props.tint} waiting />}
			</MachineState>
			<MachineState machine={props.session.machine} path="SignedIn">
				{() => props.children}
			</MachineState>
		</Suspense>
	)
}
