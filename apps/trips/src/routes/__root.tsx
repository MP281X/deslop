// oxlint-disable-next-line import/no-unassigned-import -- Importing registers the layout the server's Live Activity pushes name.
import '#lib/activities.tsx'

import {useAtomMount, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

import {Array, Option} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {Loaded, SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'

import {bookingsAtom} from '#lib/bookings.ts'
import {calendarAtom} from '#lib/calendar.ts'
import {openedAtom} from '#lib/deep-links.ts'
import {pushAtom} from '#lib/notifications.ts'
import {session} from '#lib/session.ts'
import {primary} from '#lib/status.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {BookingRoute} from '#routes/bookings/$id.tsx'
import icon from '#routes/icon.png'
import {BookingId} from '#services/bookings/schema.ts'

function Destination(props: {onClose: () => void; value: string}) {
	return (
		<Loaded atom={bookingsAtom} name="Trips">
			{bookings => (
				<BookingRoute key={props.value} bookings={bookings} id={BookingId.make(props.value)} onClose={props.onClose} />
			)}
		</Loaded>
	)
}

function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(calendarAtom)
	const opened = useAtomValue(openedAtom)
	const [path, setPath] = useState(() =>
		Option.match(AsyncResult.value(opened), {onNone: () => Array.empty<BookingId>(), onSome: id => [id]})
	)
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setPath([id])))
	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={values => setPath(Array.map(values, value => BookingId.make(value)))}
				modifiers={[tint(colors.foreground)]}
			>
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
	return (
		<SessionGate logo={icon} session={session} tint={primary}>
			<AppRoutes />
		</SessionGate>
	)
}
