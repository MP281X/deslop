import {useAtomMount, useAtomRefresh, useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, Result} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {BlankScreen, FailureContent, SessionGate, shownOf} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {updateAtom} from '@deslop/runtime/mobile'

import {activitiesAtom, bookingsAtom, calendarAtom, openedAtom, primary, pushAtom, session} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {BookingRoute} from '#routes/bookings/$id.tsx'
import icon from '#routes/icon.png'

function Destination(props: {onClose: () => void; value: string}) {
	const loaded = useAtomSuspense(bookingsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(bookingsAtom)
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Trips" onRetry={refresh} />
	}
	return <BookingRoute key={props.value} bookings={shown.success} id={props.value} onClose={props.onClose} />
}

function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(activitiesAtom)
	useAtomMount(calendarAtom)
	const opened = useAtomValue(openedAtom)
	const [path, setPath] = useState(() =>
		Option.match(AsyncResult.value(opened), {onNone: () => Array.empty<string>(), onSome: id => [id]})
	)
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setPath([id])))
	return (
		<Host style={{flex: 1}}>
			<NavigationStack path={path} onPathChange={setPath} modifiers={[tint(colors.foreground)]}>
				<HomeRoute onOpen={id => setPath([id])} />
				{Array.map(path, value => (
					<NavigationDestination key={value} value={value}>
						<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
							<Destination value={value} onClose={() => setPath([])} />
						</Suspense>
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<SessionGate logo={icon} session={session.machine} tint={primary}>
				<AppRoutes />
			</SessionGate>
		</Suspense>
	)
}
