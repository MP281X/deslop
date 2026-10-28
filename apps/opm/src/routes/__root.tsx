import {
	useAtom,
	useAtomMount,
	useAtomRefresh,
	useAtomSubscribe,
	useAtomSuspense,
	useAtomValue
} from '@effect/atom-react'

import {Array, Cause, Option, Schema} from 'effect'

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

import {chaptersAtom, diagnosticsAtom, openedAtom, pushAtom, session, signInAtom} from '#lib/utils.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute} from '#routes/chapters/$number.tsx'
import icon from '#routes/icon.png'
import {keyOf} from '#services/chapters/lib/utils.ts'
import {ChapterPath} from '#services/chapters/schema.ts'
import type {Series} from '#services/chapters/schema.ts'

// The spinner fills the screen, so it sits in the middle of it on the app's background.
function Loading() {
	return (
		<Host style={{flex: 1}}>
			<ProgressView modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]} />
		</Host>
	)
}

// A failure thrown while rendering is fatal in React Native and closes the app, so the root reads it as a value and offers a retry.
function Failed(props: {cause: Cause.Cause<unknown>}) {
	const refreshChapters = useAtomRefresh(chaptersAtom)
	return (
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

// The app opens on the list; a tapped notification opens its chapter.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
	const loaded = useAtomSuspense(chaptersAtom, {includeFailure: true})
	const opened = useAtomValue(openedAtom)
	const [series, setSeries] = useState<Series>(() =>
		Option.match(opened, {onNone: () => 'manga', onSome: chapter => chapter.series})
	)
	const [resumePage, setResumePage] = useState<number>()
	const [path, setPath] = useState(() =>
		Option.match(opened, {onNone: () => Array.empty<string>(), onSome: chapter => [keyOf(chapter)]})
	)
	useAtomSubscribe(openedAtom, tapped =>
		Option.match(tapped, {
			onNone: () => undefined,
			onSome: chapter => {
				setResumePage(undefined)
				setSeries(chapter.series)
				setPath([keyOf(chapter)])
			}
		})
	)
	function open(number: number, page?: number) {
		setResumePage(page)
		setPath([keyOf({number, series})])
	}
	if (AsyncResult.isFailure(loaded)) return <Failed cause={loaded.cause} />
	const chapters = loaded.value

	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<ChaptersRoute
					key={series}
					chapters={Array.filter(chapters, chapter => chapter.series === series)}
					onOpen={open}
					series={series}
					onSeries={setSeries}
				/>
				{Array.map(path, value =>
					Option.match(Schema.decodeUnknownOption(ChapterPath)(value), {
						onNone: () => undefined,
						onSome: target => (
							<NavigationDestination key={value} value={value}>
								<ReaderRoute key={value} chapters={chapters} number={target[2]} series={target[0]} start={resumePage} />
							</NavigationDestination>
						)
					})
				)}
			</NavigationStack>
		</Host>
	)
}

function SessionRoute() {
	const saved = useAtomSuspense(session.atom).value
	const [signIn, start] = useAtom(signInAtom)
	const iconUri = useAtomSuspense(assetAtom(icon)).value
	if (Option.isSome(saved)) {
		return (
			<Suspense fallback={<Loading />}>
				<AppRoutes />
			</Suspense>
		)
	}
	return (
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

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<Loading />}>
			<SessionRoute />
		</Suspense>
	)
}
