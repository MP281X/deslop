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

import {openedFlight} from '#lib/day.ts'
import {openedAtom} from '#lib/deep-links.ts'
import type {Target} from '#lib/deep-links.ts'
import {boardAtom, flightsAtom, clipboard, nowAtom} from '#lib/flights.ts'
import {pushAtom} from '#lib/notifications.ts'
import {session} from '#lib/session.ts'
import {travelPromptAtom} from '#lib/travel.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {FlightRoute} from '#routes/flights/$id.tsx'
import type {FlightId} from '#services/flights/schema.ts'

// A day link resolves here, once the flights are loaded, and keeps following the day while it stays open.
function Destination(props: {onClose: () => void; onOpen: (id: FlightId) => void; target: Option.Option<Target>}) {
	const live = useAtomValue(flightsAtom)
	const now = useAtomValue(nowAtom)
	return (
		<Loaded atom={flightsAtom}>
			{flights => {
				const id = Option.map(props.target, target => openedFlight(flights, target, now))
				return (
					<FlightRoute
						key={Option.getOrElse(id, Function.constant('board'))}
						flights={flights}
						id={id}
						offline={AsyncResult.isFailure(live)}
						onClose={props.onClose}
						onOpen={props.onOpen}
					/>
				)
			}}
		</Loaded>
	)
}

// `openedAtom` logs an initial URL-read failure and keeps listening for later opens; no opened flight is the valid home, not a replacement flight or a successful read of flight data.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(travelPromptAtom)
	const launched = useAtomValue(openedAtom)
	const [opened, setOpened] = useState(() => AsyncResult.value(launched))
	useAtomSubscribe(openedAtom, tapped =>
		Option.map(AsyncResult.value(tapped), target => setOpened(Option.some(target)))
	)
	function open(id: FlightId) {
		setOpened(Option.some({day: false, id} satisfies Target))
	}
	return (
		<Host style={{flex: 1}}>
			{/* Over the whole window, so the list's copy below an item in laptop posture asks once. */}
			<PasteSheet clipboard={clipboard}>
				{/* Half open like a laptop, only a flight's board, or the change between its flights, stands above the list. */}
				<ListDetail
					board={Option.isSome(useAtomValue(boardAtom))}
					opened={Option.isSome(opened)}
					onClose={() => setOpened(Option.none())}
					modifiers={[tint(colors.foreground)]}
					list={<HomeRoute opened={Option.isSome(opened)} onOpen={open} />}
					detail={
						<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
							<Destination target={opened} onClose={() => setOpened(Option.none())} onOpen={open} />
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
