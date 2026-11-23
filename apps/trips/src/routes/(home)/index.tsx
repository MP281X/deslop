import {useAtom, useAtomMount, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Option, pipe} from 'effect'
import type {DateTime} from 'effect'

import {Button as NativeButton, HStack, Image, Section, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	accessibilityValue,
	buttonStyle,
	contentShape,
	font,
	foregroundStyle,
	frame,
	imageScale,
	listRowSeparator,
	opacity,
	padding,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {useListBeside, useListTiled} from '@deslop/components-mobile/blocks/list-detail'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {colors, space} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {ItemGroup} from '@deslop/components-mobile/ui/item'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'

import {boardChangeOf, changeWords, datesOf, departureTimes, nextHero, pastOf, upcomingOf} from '#lib/day.ts'
import {flightsAtom, clipboard, nowAtom, removal} from '#lib/flights.ts'
import {HeroView, TimeRow} from '#lib/rows.tsx'
import type {RowProblem} from '#lib/rows.tsx'
import {primary, session} from '#lib/session.ts'
import {travelAtom} from '#lib/travel.ts'
import {
	arrivalClockOf,
	cancelledOf,
	clockAt,
	isStale,
	labelled,
	line,
	routeOf,
	titleOf
} from '#services/flights/lib/utils.ts'
import type {FlightId, Flight, TravelTime} from '#services/flights/schema.ts'

type Trouble = {problem: RowProblem; word: string}

// Only a problem marks a row: a cancellation, a diversion, or live data that stopped updating, said in its small print.
function troubleOf(flight: Flight, now: DateTime.Utc) {
	if (cancelledOf(flight)) return Option.some<Trouble>({problem: 'bad', word: 'cancelled'})
	return Option.flatMap(flight.live, live => {
		if (live.state === 'diverted') return Option.some<Trouble>({problem: 'bad', word: 'diverted'})
		return Option.liftPredicate<Trouble>(
			{problem: 'warn', word: `updated ${clockAt(live.checkedAt, flight.from.timeZone)}`},
			() => isStale(flight, now)
		)
	})
}

// A flight: its route, its number with where it boards and when it lands, and its departure large, the booked time struck through beside it.
function FlightRow(props: {flight: Flight; now: DateTime.Utc; onOpen: (id: FlightId) => void}) {
	const trouble = troubleOf(props.flight, props.now)
	// Beside the opened flight the row opens nothing new, so it draws no chevron.
	const beside = useListBeside()
	return (
		<RemovableRow
			id={props.flight.id}
			removal={removal}
			onOpen={() => props.onOpen(props.flight.id)}
			modifiers={[listRowSeparator('visible')]}
		>
			{pending => (
				<TimeRow
					chevron={!pending && !beside}
					label={routeOf(props.flight)}
					problem={Option.map(trouble, found => found.problem)}
					size="big"
					sub={Option.some(
						line([
							Option.some(titleOf(props.flight)),
							labelled(
								'gate',
								Option.flatMap(props.flight.live, live => live.departureGate)
							),
							Option.some(`lands ${arrivalClockOf(props.flight)}`),
							Option.map(trouble, found => found.word)
						])
					)}
					{...departureTimes(props.flight)}
				/>
			)}
		</RemovableRow>
	)
}

// The change between two flights as a row of its own, with what it was booked as once it is tight.
function ChangeRow(props: {feeder: Flight; flight: Flight}) {
	const change = changeWords(props.feeder, props.flight)
	return (
		<TimeRow
			chevron={false}
			label={change.label}
			problem={Option.liftPredicate('warn' as const, () => change.tight)}
			size="quiet"
			sub={Option.none()}
			value={change.was}
			was={Option.none()}
		/>
	)
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
					buttonStyle('plain'),
					accessibilityValue(
						Boolean.match(props.expanded, {
							onFalse: Function.constant('Collapsed'),
							onTrue: Function.constant('Expanded')
						})
					)
				]}
			>
				<HStack
					spacing={space[3]}
					modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), contentShape(shapes.rectangle())]}
				>
					<Text modifiers={[font({textStyle: 'body'}), foregroundStyle(colors.foreground)]}>Past Flights</Text>
					<Text
						modifiers={[
							font({textStyle: 'body'}),
							foregroundStyle(colors.mutedForeground),
							frame({alignment: 'trailing', maxWidth: Infinity})
						]}
					>
						{`${props.flights.length}`}
					</Text>
					<Image
						systemName={Boolean.match(props.expanded, {
							onFalse: Function.constant('chevron.right'),
							onTrue: Function.constant('chevron.down')
						})}
						modifiers={[imageScale('small'), foregroundStyle(colors.mutedForeground), opacity(0.55)]}
					/>
				</HStack>
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

// The day in order under its date: the next step large first, each flight a row with its time, and the change between two flights a row of its own; later days, then the flights already flown. Below a laptop's board the change it shows has no row.
function Days(props: {flights: readonly Flight[]; onOpen: (id: FlightId) => void; opened: boolean}) {
	const [pastOpen, setPastOpen] = useAtom(pastOpenAtom)
	const now = useAtomValue(nowAtom)
	const travel = pipe(useAtomValue(travelAtom), AsyncResult.value, Option.getOrElse(Array.empty<TravelTime>))
	const upcoming = upcomingOf(props.flights, now)
	// Beside the flight or below its board the next step is already on screen.
	const beside = useListBeside()
	const tiled = useListTiled()
	return (
		<>
			{Array.map(
				datesOf(
					props.flights,
					now,
					Option.filter(boardChangeOf(props.flights, now), () => beside && !tiled && !props.opened)
				),
				(date, index) => (
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
				)
			)}
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

function Flights(props: {onOpen: (id: FlightId) => void; opened: boolean}) {
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
					<Days flights={flights} opened={props.opened} onOpen={props.onOpen} />
				</ItemGroup>
			)}
		</VStack>
	)
}

// Native navigation and clipboard/account controls do not wait for the flights stream; the bar marks flights that stopped updating. No title: the day is the page.
export function HomeRoute(props: {onOpen: (id: FlightId) => void; opened: boolean}) {
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
				<Flights opened={props.opened} onOpen={props.onOpen} />
			</Suspense>
		</ListToolbar>
	)
}
