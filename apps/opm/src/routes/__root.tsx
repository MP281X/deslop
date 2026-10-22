import {useAtom, useAtomMount, useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Number, Option} from 'effect'

import {Button, Host, NavigationDestination, NavigationStack, ProgressView, Text, VStack} from '@expo/ui/swift-ui'
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
import {Suspense, useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {chaptersAtom, openedAtom, pushAtom, sessionAtom, signInAtom} from '#lib/utils.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute} from '#routes/chapters/$number.tsx'
import {resumeOf} from '#services/chapters/lib/utils.ts'

// The spinner fills the screen, so it sits in the middle of it on the app's background.
function Loading() {
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<ProgressView modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]} />
		</Host>
	)
}

export function RootRoute() {
	return (
		<Suspense fallback={<Loading />}>
			<SessionRoute />
		</Suspense>
	)
}

function SessionRoute() {
	const session = useAtomSuspense(sessionAtom).value
	const [signIn, start] = useAtom(signInAtom)
	if (Option.isSome(session)) {
		return (
			<Suspense fallback={<Loading />}>
				<AppRoutes />
			</Suspense>
		)
	}
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<VStack
				spacing={20}
				// The padding comes first so the colour behind it reaches every edge of the screen.
				modifiers={[
					padding({all: 24}),
					frame({maxHeight: Infinity, maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<Text
					modifiers={[
						mono('headline', 28),
						foregroundStyle(colors.foreground),
						frame({maxHeight: Infinity}),
						padding({top: 64})
					]}
				>
					opm
				</Text>
				<Button
					onPress={() => start()}
					modifiers={[
						buttonStyle('glassProminent'),
						controlSize('large'),
						tint(colors.primary),
						foregroundStyle(colors.primaryForeground),
						disabled(AsyncResult.isWaiting(signIn))
					]}
				>
					<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>Sign in with GitHub</Text>
				</Button>
			</VStack>
		</Host>
	)
}

// The app opens on the chapter to continue, with the list one back-swipe away; a tapped notification opens its chapter.
function AppRoutes() {
	useAtomMount(updateAtom)
	useAtomMount(pushAtom)
	const chapters = useAtomSuspense(chaptersAtom).value
	const opened = useAtomValue(openedAtom)
	const [path, setPath] = useState(() =>
		Option.match(
			Option.orElse(opened, () => Option.map(resumeOf(chapters), found => found.number)),
			{onNone: () => Array.empty<string>(), onSome: number => [`${number}`]}
		)
	)
	useAtomSubscribe(openedAtom, tapped =>
		Option.match(tapped, {onNone: () => undefined, onSome: number => setPath([`${number}`])})
	)

	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The SwiftUI host is a React Native view and fills the screen through its style.
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<ChaptersRoute chapters={chapters} onOpen={number => setPath([`${number}`])} />
				{Array.map(path, number => (
					<NavigationDestination key={number} value={number}>
						<ReaderRoute key={number} chapters={chapters} number={Option.getOrElse(Number.parse(number), () => 0)} />
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
