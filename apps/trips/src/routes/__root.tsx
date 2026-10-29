import {useAtomMount, useAtomRefresh, useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {FailureScreen, LoadingScreen, SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {activitiesAtom, bookingsAtom, calendarAtom, openedAtom, pushAtom, session, signInAtom} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {BookingRoute} from '#routes/bookings/$id.tsx'
import icon from '#routes/icon.png'
import type {BookingList} from '#services/bookings/schema.ts'

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
	const refresh = useAtomRefresh(bookingsAtom)
	const opened = useAtomValue(openedAtom)
	const [path, setPath] = useState(() =>
		Option.match(AsyncResult.value(opened), {onNone: () => Array.empty<string>(), onSome: id => [id]})
	)
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setPath([id])))
	if (AsyncResult.isFailure(loaded)) return <FailureScreen cause={loaded.cause} name="Trips" onRetry={refresh} />

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

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<LoadingScreen />}>
			<SessionGate logo={icon} saved={session.atom} signIn={signInAtom}>
				<Suspense fallback={<LoadingScreen />}>
					<AppRoutes />
				</Suspense>
			</SessionGate>
		</Suspense>
	)
}
