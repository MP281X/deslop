// oxlint-disable-next-line import/no-unassigned-import -- Importing registers the layout the server's Live Activity pushes name.
import '#lib/activities.tsx'

import {useAtomMount, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

import {Function, Option} from 'effect'

import {Host} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {ListDetail} from '@deslop/components-mobile/blocks/list-detail'
import {Loaded} from '@deslop/components-mobile/blocks/loaded'
import {PasteSheet} from '@deslop/components-mobile/blocks/paste-sheet'
import {SessionGate} from '@deslop/components-mobile/blocks/session-gate'
import {colors} from '@deslop/components-mobile/theme'

import {bookingsAtom, clipboard} from '#lib/bookings.ts'
import {calendarAtom} from '#lib/calendar.ts'
import {openedAtom} from '#lib/deep-links.ts'
import {pushAtom} from '#lib/notifications.ts'
import {session} from '#lib/session.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {BookingRoute} from '#routes/bookings/$id.tsx'
import type {BookingId} from '#services/bookings/schema.ts'

function Destination(props: {id: Option.Option<BookingId>; onClose: () => void}) {
	const live = useAtomValue(bookingsAtom)
	return (
		<Loaded atom={bookingsAtom}>
			{bookings => (
				<BookingRoute
					key={Option.getOrElse(props.id, Function.constant('board'))}
					bookings={bookings}
					id={props.id}
					offline={AsyncResult.isFailure(live)}
					onClose={props.onClose}
				/>
			)}
		</Loaded>
	)
}

// `openedAtom` logs an initial URL-read failure and keeps listening for later opens; no opened booking is the valid home, not a replacement booking or a successful read of booking data.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(calendarAtom)
	const launched = useAtomValue(openedAtom)
	const [opened, setOpened] = useState(() => AsyncResult.value(launched))
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setOpened(Option.some(id))))
	return (
		<Host style={{flex: 1}}>
			{/* Over the whole window, so the list's copy below an item in laptop posture asks once. */}
			<PasteSheet clipboard={clipboard}>
				<ListDetail
					board
					opened={Option.isSome(opened)}
					onClose={() => setOpened(Option.none())}
					modifiers={[tint(colors.foreground)]}
					list={<HomeRoute onOpen={id => setOpened(Option.some(id))} />}
					detail={
						<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
							<Destination id={opened} onClose={() => setOpened(Option.none())} />
						</Suspense>
					}
				/>
			</PasteSheet>
		</Host>
	)
}

export function RootRoute() {
	return (
		<SessionGate session={session}>
			<AppRoutes />
		</SessionGate>
	)
}
