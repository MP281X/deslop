import {
	useAtom,
	useAtomMount,
	useAtomRefresh,
	useAtomSubscribe,
	useAtomSuspense,
	useAtomValue
} from '@effect/atom-react'

import {Array, Cause, Option} from 'effect'

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

import {activitiesAtom, bookingsAtom, calendarAtom, openedAtom, pushAtom, session, signInAtom} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {BookingRoute} from '#routes/bookings/$id.tsx'
import icon from '#routes/icon.png'
import type {BookingList} from '#services/bookings/schema.ts'

function Loading() {
	return (
		<Host style={{flex: 1}}>
			<ProgressView modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]} />
		</Host>
	)
}

// A failure thrown while rendering is fatal in React Native and closes the app, so the root reads it as a value and offers a retry.
function Failed(props: {cause: Cause.Cause<unknown>}) {
	const refresh = useAtomRefresh(bookingsAtom)
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
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>Trips hit an error</Text>
				<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(6)]}>
					{Cause.pretty(props.cause)}
				</Text>
				<Button
					onPress={() => refresh()}
					modifiers={[buttonStyle('glassProminent'), tint(colors.primary), foregroundStyle(colors.primaryForeground)]}
				>
					<Text modifiers={[mono('headline', 16)]}>Try Again</Text>
				</Button>
			</VStack>
		</Host>
	)
}

// A pushed booking by its id.
function Destination(props: {bookings: BookingList; onClose: () => void; value: string}) {
	return <BookingRoute key={props.value} bookings={props.bookings} id={props.value} onClose={props.onClose} />
}

// The app opens on the trip list; an island, a calendar event or a notification opens its booking.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(activitiesAtom)
	useAtomMount(calendarAtom)
	const loaded = useAtomSuspense(bookingsAtom, {includeFailure: true})
	const opened = useAtomValue(openedAtom)
	const [path, setPath] = useState(() =>
		Option.match(AsyncResult.value(opened), {onNone: () => Array.empty<string>(), onSome: id => [id]})
	)
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setPath([id])))
	if (AsyncResult.isFailure(loaded)) return <Failed cause={loaded.cause} />

	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<HomeRoute bookings={loaded.value} onOpen={id => setPath([id])} />
				{Array.map(path, value => (
					<NavigationDestination key={value} value={value}>
						<Destination bookings={loaded.value} value={value} onClose={() => setPath([])} />
					</NavigationDestination>
				))}
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
