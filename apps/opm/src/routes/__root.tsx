import {
	useAtom,
	useAtomMount,
	useAtomRefresh,
	useAtomSubscribe,
	useAtomSuspense,
	useAtomValue
} from '@effect/atom-react'

import {Array, Cause, Number, Option} from 'effect'

import {
	Button,
	Host,
	Image,
	NavigationDestination,
	NavigationStack,
	ProgressView,
	Text,
	VStack
} from '@expo/ui/swift-ui'
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
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'
import {assetAtom} from '@deslop/components-mobile/utils'
import {updateAtom} from '@deslop/runtime/mobile'

import {chaptersAtom, diagnosticsAtom, openedAtom, pushAtom, sessionAtom, signInAtom} from '#lib/utils.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute} from '#routes/chapters/$number.tsx'
import icon from '#routes/icon.png'

// The spinner fills the screen, so it sits in the middle of it on the app's background.
function Loading() {
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<ProgressView modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]} />
		</Host>
	)
}

// A failure thrown while rendering is fatal in React Native and closes the app, so the root reads it as a value and offers a retry.
function Failed(props: {cause: Cause.Cause<unknown>}) {
	const refreshSession = useAtomRefresh(sessionAtom)
	const refreshChapters = useAtomRefresh(chaptersAtom)
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<VStack
				spacing={12}
				modifiers={[
					padding({all: 24}),
					frame({maxHeight: Infinity, maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>opm hit an error</Text>
				<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(6)]}>
					{Cause.pretty(props.cause)}
				</Text>
				<Button
					onPress={() => {
						refreshSession()
						refreshChapters()
					}}
					modifiers={[buttonStyle('glassProminent'), tint(colors.primary), foregroundStyle(colors.primaryForeground)]}
				>
					<Text modifiers={[mono('headline', 16)]}>Try Again</Text>
				</Button>
			</VStack>
		</Host>
	)
}

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<Loading />}>
			<SessionRoute />
		</Suspense>
	)
}

function SessionRoute() {
	const session = useAtomSuspense(sessionAtom, {includeFailure: true})
	const [signIn, start] = useAtom(signInAtom)
	const iconUri = useAtomSuspense(assetAtom(icon)).value
	if (AsyncResult.isFailure(session)) return <Failed cause={session.cause} />
	if (Option.isSome(session.value)) {
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
				<Image
					uiImage={iconUri}
					modifiers={[
						resizable(),
						frame({height: 64, width: 64}),
						clipShape('roundedRectangle', 14),
						frame({maxHeight: Infinity}),
						padding({bottom: 64})
					]}
				/>
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

// The app opens on the list; a tapped notification opens its chapter.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
	const loaded = useAtomSuspense(chaptersAtom, {includeFailure: true})
	const opened = useAtomValue(openedAtom)
	const [resumePage, setResumePage] = useState<number>()
	const [path, setPath] = useState(() =>
		Option.match(opened, {onNone: () => Array.empty<string>(), onSome: number => [`${number}`]})
	)
	useAtomSubscribe(openedAtom, tapped =>
		Option.match(tapped, {
			onNone: () => undefined,
			onSome: number => {
				setResumePage(undefined)
				setPath([`${number}`])
			}
		})
	)
	function open(number: number, page?: number) {
		setResumePage(page)
		setPath([`${number}`])
	}
	if (AsyncResult.isFailure(loaded)) return <Failed cause={loaded.cause} />
	const chapters = loaded.value

	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The SwiftUI host is a React Native view and fills the screen through its style.
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<ChaptersRoute chapters={chapters} onOpen={open} />
				{Array.map(path, number => (
					<NavigationDestination key={number} value={number}>
						<ReaderRoute
							key={number}
							chapters={chapters}
							number={Option.getOrElse(Number.parse(number), () => 0)}
							{...Option.match(Option.fromUndefinedOr(resumePage), {onNone: () => ({}), onSome: start => ({start})})}
						/>
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
