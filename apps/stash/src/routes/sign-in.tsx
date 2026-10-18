import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Button, ContentUnavailableView, Text, VStack} from '@expo/ui/swift-ui'
import {
	background,
	buttonStyle,
	controlSize,
	disabled,
	foregroundStyle,
	frame,
	padding,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {colors, mono} from '@deslop/components-mobile/theme'

import {signInAtom} from '#lib/utils.ts'

export function SignInRoute() {
	const signIn = useAtomSet(signInAtom)
	const waiting = AsyncResult.isWaiting(useAtomValue(signInAtom))
	return (
		<VStack
			spacing={12}
			modifiers={[
				padding({horizontal: 24}),
				frame({maxHeight: Infinity, maxWidth: Infinity}),
				background(colors.background)
			]}
		>
			<ContentUnavailableView
				title="Sign In"
				systemImage="person.crop.circle"
				description="Sign in with the GitHub account this stash belongs to."
			/>
			<Button
				onPress={() => signIn()}
				modifiers={[
					buttonStyle('glassProminent'),
					controlSize('large'),
					tint(colors.primary),
					foregroundStyle(colors.primaryForeground),
					disabled(waiting)
				]}
			>
				<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>Sign In with GitHub</Text>
			</Button>
		</VStack>
	)
}
