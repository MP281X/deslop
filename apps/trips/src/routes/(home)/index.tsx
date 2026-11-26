import {useAtom, useAtomMount, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Option, pipe} from 'effect'
import type {DateTime} from 'effect'

import {Button as NativeButton, Image, Section, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	accessibilityValue,
	buttonStyle,
	frame,
	listRowSeparator,
	padding,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {useListBeside} from '@deslop/components-mobile/blocks/list-detail'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {Row} from '@deslop/components-mobile/blocks/row'
import type {RowProblem} from '@deslop/components-mobile/blocks/row'
import {space} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {Item, ItemGroup, itemRow} from '@deslop/components-mobile/ui/item'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'

import {changeWords, datesOf, departureTimes, nextHero, pastOf, tripOf, troubleOf, upcomingOf} from '#lib/day.ts'
import type {TripStep} from '#lib/day.ts'
import {flightsAtom, clipboard, nowAtom, removal} from '#lib/flights.ts'
import {HeroView} from '#lib/rows.tsx'
import {primary, session} from '#lib/session.ts'
import {travelAtom} from '#lib/travel.ts'
import {arrivalClockOf, labelled, line, routeOf, titleOf} from '#services/flights/lib/utils.ts'
import type {FlightId, Flight, TravelTime} from '#services/flights/schema.ts'

const NO_TRIP = {dates: [], flights: []} satisfies ReturnType<typeof tripOf>

// A flight: its route, its number with where it boards and when it lands, and its departure at the trailing edge, the booked time struck through before it.
function FlightRow(props: {flight: Flight; now: DateTime.Utc; onOpen: (id: FlightId) => void}) {
	const times = departureTimes(props.flight)
	return (
		<RemovableRow id={props.flight.id} removal={removal} onOpen={() => props.onOpen(props.flight.id)} size="xs">
			{pending => (
				<Row
					muted={pending}
					line={Option.some(
						line([
							Option.some(titleOf(props.flight)),
							labelled(
								'gate',
								Option.flatMap(props.flight.live, live => live.departureGate)
							),
							Option.some(`lands ${arrivalClockOf(props.flight)}`)
						])
					)}
					problem={troubleOf(props.flight, props.now)}
					title={routeOf(props.flight)}
					trailing={times.value}
					was={times.was}
				/>
			)}
		</RemovableRow>
	)
}

// A step of the trip, which opens its flight.
function StepRow(props: {onOpen: (id: FlightId) => void; step: TripStep}) {
	return (
		<RemovableRow
			id={props.step.flight.id}
			removal={removal}
			onOpen={() => props.onOpen(props.step.flight.id)}
			size="xs"
		>
			{pending => (
				<Row
					muted={pending}
					line={props.step.line}
					problem={props.step.problem}
					title={props.step.title}
					trailing={Option.some(props.step.time)}
					was={props.step.was}
				/>
			)}
		</RemovableRow>
	)
}

// The change between two flights as a row of its own, with what it was booked as once it is tight.
function ChangeRow(props: {feeder: Flight; flight: Flight}) {
	const change = changeWords(props.feeder, props.flight)
	return (
		<Item size="xs" modifiers={itemRow}>
			<Row
				line={Option.none()}
				problem={Option.map(change.was, reason => ({reason, status: 'warning'}) satisfies RowProblem)}
				title={change.label}
				trailing={Option.none()}
			/>
		</Item>
	)
}

function flightsIn(count: number) {
	if (count === 1) return '1 flight'
	return `${count} flights`
}

function PastFlights(props: {
	expanded: boolean
	flights: readonly Flight[]
	now: DateTime.Utc
	onExpandedChange: (expanded: boolean) => void
	onOpen: (id: FlightId) => void
}) {
	if (Array.isReadonlyArrayEmpty(props.flights)) return undefined
	// The row is the toggle: a plain list draws none on a collapsible section.
	return (
		<Section>
			<NativeButton
				onPress={() => props.onExpandedChange(!props.expanded)}
				modifiers={[
					...itemRow,
					buttonStyle('plain'),
					accessibilityValue(
						Boolean.match(props.expanded, {
							onFalse: Function.constant('Collapsed'),
							onTrue: Function.constant('Expanded')
						})
					)
				]}
			>
				<Item size="xs">
					<Row
						line={Option.some(flightsIn(props.flights.length))}
						problem={Option.none()}
						title="Past Flights"
						trailing={Option.none()}
					/>
				</Item>
			</NativeButton>
			{props.expanded &&
				Array.map(props.flights, flight => (
					<FlightRow key={flight.id} flight={flight} now={props.now} onOpen={props.onOpen} />
				))}
		</Section>
	)
}

// Every copy of the list shows Past the same way, so the copy below the board in laptop posture keeps it open when the phone lies flat.
const pastOpenAtom = Atom.make(false)

// The day in order under its date. Folded, the next step large first, each flight a row with its time, and the change between two flights a row of its own. Beside the board, or below it half open like a laptop, the next step stands there instead, so the first trip is its steps; each later date follows with its flights, then the flights already flown.
function Days(props: {flights: readonly Flight[]; onOpen: (id: FlightId) => void}) {
	const [pastOpen, setPastOpen] = useAtom(pastOpenAtom)
	const now = useAtomValue(nowAtom)
	const travel = pipe(useAtomValue(travelAtom), AsyncResult.value, Option.getOrElse(Array.empty<TravelTime>))
	const upcoming = upcomingOf(props.flights, now)
	const beside = useListBeside()
	const trip = Boolean.match(beside, {onFalse: () => NO_TRIP, onTrue: () => tripOf(props.flights, now)})
	return (
		<>
			{Array.map(trip.dates, date => (
				<Section key={date.date} title={date.date}>
					{Array.map(date.steps, step => (
						<StepRow key={step.key} step={step} onOpen={props.onOpen} />
					))}
				</Section>
			))}
			{Array.map(datesOf(props.flights, now, trip.flights), (date, index) => (
				<Section key={date.date} title={date.date}>
					{index === 0 &&
						!beside &&
						Option.match(nextHero(props.flights, now, travel), {
							onNone: Function.constNull,
							onSome: hero => (
								<VStack modifiers={[listRowSeparator('hidden'), padding({bottom: space[2]})]}>
									<HeroView hero={hero} size="read" />
								</VStack>
							)
						})}
					{Array.flatMap(date.rows, row => [
						...Option.match(row.feeder, {
							onNone: () => [],
							onSome: feeder => [<ChangeRow key={`${row.flight.id} change`} feeder={feeder} flight={row.flight} />]
						}),
						<FlightRow key={row.flight.id} flight={row.flight} now={now} onOpen={props.onOpen} />
					])}
				</Section>
			))}
			{Array.isReadonlyArrayEmpty(upcoming) && (
				<Section>
					<Empty>
						<EmptyMedia>
							<Image systemName="ticket" modifiers={[accessibilityLabel('Nothing coming up')]} />
						</EmptyMedia>
					</Empty>
				</Section>
			)}
			<PastFlights
				flights={pastOf(props.flights, now)}
				expanded={pastOpen}
				now={now}
				onExpandedChange={setPastOpen}
				onOpen={props.onOpen}
			/>
		</>
	)
}

function Flights(props: {onOpen: (id: FlightId) => void}) {
	const loaded = useAtomSuspense(flightsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(flightsAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const adding = pipe(
		useMachineResult(AtomMachine.select(clipboard.atom, 'Answering')),
		AsyncResult.value,
		Option.flatten,
		Option.exists(current => current.save)
	)
	const blocking = Option.getOrUndefined(blockingFailure(loaded))
	if (blocking !== undefined) return <FailureContent cause={blocking} onRetry={refresh} />
	const flights = AsyncResult.getOrElse(loaded, () => [])
	// One root: a SwiftUI modifier on several sibling views applies to each, so the dialog and the toolbar would repeat.
	return (
		<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
			{adding && <ItemGroupSkeleton rows={1} descriptionLines={1} />}
			{Array.isReadonlyArrayEmpty(flights) && !adding && (
				<Empty>
					<EmptyContent>
						<Button
							size="lg"
							systemImage="doc.text"
							onPress={() => paste(clipboard.events.Returned())}
							modifiers={[tint(primary)]}
						>
							Paste Ticket
						</Button>
					</EmptyContent>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(flights) && (
				<ItemGroup modifiers={[tint(primary)]}>
					<Days flights={flights} onOpen={props.onOpen} />
				</ItemGroup>
			)}
		</VStack>
	)
}

// Native navigation and clipboard/account controls do not wait for the flights stream; the bar marks flights that stopped updating. No title: the day is the page.
export function HomeRoute(props: {onOpen: (id: FlightId) => void}) {
	const loaded = useAtomValue(flightsAtom)
	useAtomMount(problemSinceAtom(flightsAtom))
	return (
		<ListToolbar
			title=""
			session={session}
			problem={Option.liftPredicate(
				<Problem source={flightsAtom} label="Out of date" onRetry={useAtomRefresh(flightsAtom)} />,
				() => AsyncResult.isFailure(loaded) && Option.isNone(blockingFailure(loaded))
			)}
		>
			<Suspense fallback={<ItemGroupSkeleton rows={10} descriptionLines={1} />}>
				<Flights onOpen={props.onOpen} />
			</Suspense>
		</ListToolbar>
	)
}
