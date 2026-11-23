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

import {openedAtom} from '#lib/deep-links.ts'
import {boardAtom, flightsAtom, clipboard} from '#lib/flights.ts'
import {pushAtom} from '#lib/notifications.ts'
import {session} from '#lib/session.ts'
import {travelPromptAtom} from '#lib/travel.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {FlightRoute} from '#routes/flights/$id.tsx'
import type {FlightId} from '#services/flights/schema.ts'

function Destination(props: {id: Option.Option<FlightId>; onClose: () => void}) {
	const live = useAtomValue(flightsAtom)
	return (
		<Loaded atom={flightsAtom}>
			{flights => (
				<FlightRoute
					key={Option.getOrElse(props.id, Function.constant('board'))}
					flights={flights}
					id={props.id}
					offline={AsyncResult.isFailure(live)}
					onClose={props.onClose}
				/>
			)}
		</Loaded>
	)
}

// `openedAtom` logs an initial URL-read failure and keeps listening for later opens; no opened flight is the valid home, not a replacement flight or a successful read of flight data.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(travelPromptAtom)
	const launched = useAtomValue(openedAtom)
	const [opened, setOpened] = useState(() => AsyncResult.value(launched))
	useAtomSubscribe(openedAtom, tapped => Option.map(AsyncResult.value(tapped), id => setOpened(Option.some(id))))
	return (
		<Host style={{flex: 1}}>
			{/* Over the whole window, so the list's copy below an item in laptop posture asks once. */}
			<PasteSheet clipboard={clipboard}>
				{/* Half open like a laptop, only a flight's board stands above the list. */}
				<ListDetail
					board={Option.isSome(useAtomValue(boardAtom))}
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
