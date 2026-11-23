import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Option, String, pipe} from 'effect'

import {
	Button as NativeButton,
	HStack,
	Image,
	List,
	Menu,
	Picker,
	Section,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	buttonStyle,
	font,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowSeparator,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	refreshable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {useListBeside, useListTiled} from '@deslop/components-mobile/blocks/list-detail'
import {backHidden, barNeverMinimizes} from '@deslop/components-mobile/lib/toolbar'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {weekdayOf} from '@deslop/runtime/shared/format'

import {changeHero, changeWords, departureTimes, heroOf, movedFrom} from '#lib/day.ts'
import type {Hero} from '#lib/day.ts'
import {boardAtom, flightsAtom, nowAtom, refreshAtom, removal} from '#lib/flights.ts'
import {mapsAtom, uberAtom} from '#lib/rides.ts'
import {HeroView, TimeRow} from '#lib/rows.tsx'
import type {HeroSize} from '#lib/rows.tsx'
import {primary} from '#lib/session.ts'
import {setTravelAtom, TRAVEL_CHOICES, travelAtom, travelLabel} from '#lib/travel.ts'
import {
	airportByOf,
	arrivalClockOf,
	arrivalOf,
	boardsAt,
	bookedOf,
	cityOf,
	clockAt,
	departureOf,
	journeyOf,
	labelled,
	line,
	routeOf,
	stepOf,
	titleOf,
	travelTo
} from '#services/flights/lib/utils.ts'
import type {Journey, Step} from '#services/flights/lib/utils.ts'
import type {FlightId, FlightList, Flight, TravelTime} from '#services/flights/schema.ts'

// Said large once the flight landed: where, and when.
function landedHero(flight: Flight) {
	return {
		label: 'Landed in',
		pending: false,
		problem: Option.none(),
		right: `at ${arrivalClockOf(flight)}`,
		value: cityOf(flight.to),
		was: Option.none()
	} satisfies Hero
}

// The way to the airport, while he still has to get there: directions and a ride.
function Rides(props: {flight: Flight}) {
	const maps = useAtomSet(mapsAtom)
	const uber = useAtomSet(uberAtom)
	return (
		<HStack spacing={space[3]} modifiers={[listRowSeparator('hidden')]}>
			<Button
				variant="outline"
				size="lg"
				systemImage="map"
				onPress={() => maps(props.flight.from)}
				modifiers={[frame({maxWidth: Infinity})]}
			>
				Directions
			</Button>
			<Button
				variant="outline"
				size="lg"
				systemImage="car"
				onPress={() => uber(props.flight.from)}
				modifiers={[frame({maxWidth: Infinity})]}
			>
				Uber
			</Button>
		</HStack>
	)
}

// How long the trip to this airport takes, saved once for the airport; when to leave hangs on it.
function TravelRow(props: {flight: Flight; travel: readonly TravelTime[]}) {
	const setTravel = useAtomSet(setTravelAtom)
	return Option.match(props.flight.from.code, {
		onNone: Function.constNull,
		onSome: airport => (
			<Picker<number>
				label={`Trip to ${cityOf(props.flight.from)} airport`}
				selection={pipe(
					travelTo(props.flight, props.travel),
					Option.map(Duration.toMinutes),
					Option.getOrElse(Function.constant(0))
				)}
				onSelectionChange={minutes => {
					if (minutes > 0) setTravel({airport, minutes})
				}}
			>
				{Option.isNone(travelTo(props.flight, props.travel)) && <Text modifiers={[tag(0)]}>Not Set</Text>}
				{Array.map(TRAVEL_CHOICES, minutes => (
					<Text key={minutes} modifiers={[tag(minutes)]}>
						{travelLabel(minutes)}
					</Text>
				))}
			</Picker>
		)
	})
}

// The plane flying in, while it is the cause of a delay and he has not boarded.
function inboundRow(flight: Flight, current: Step) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(
			late => late >= 15 && (current.phase === 'leave' || current.phase === 'airport' || current.phase === 'gate')
		),
		Option.map(late => (
			<TimeRow
				key="inbound"
				chevron={false}
				label="Plane flying in"
				problem={Option.some('warn')}
				size="plain"
				sub={Option.some(`${late} min late`)}
				value={Option.none()}
				was={Option.none()}
			/>
		))
	)
}

// The day's times still ahead for this flight; a time it passed leaves the list.
function Times(props: {current: Step; feeder: Option.Option<Flight>; flight: Flight; now: DateTime.Utc}) {
	const at = props.current.flight.id === props.flight.id
	const boarded =
		at && props.current.phase !== 'leave' && props.current.phase !== 'airport' && props.current.phase !== 'gate'
	const flown = at && (props.current.phase === 'airborne' || props.current.phase === 'landed')
	const gate = Option.flatMap(props.flight.live, live => live.departureGate)
	return (
		<>
			{at && props.current.phase === 'leave' && (
				<TimeRow
					chevron={false}
					label="Airport by"
					problem={Option.none()}
					size="plain"
					sub={Option.some('an hour before departure')}
					value={Option.some(clockAt(airportByOf(props.flight), props.flight.from.timeZone))}
					was={Option.none()}
				/>
			)}
			{at && Option.getOrUndefined(inboundRow(props.flight, props.current))}
			{Option.match(props.feeder, {
				onNone: Function.constNull,
				onSome: feeder => (
					<TimeRow
						chevron={false}
						label={`${titleOf(feeder)} lands`}
						problem={Option.none()}
						size="plain"
						sub={Option.some(feeder.to.name)}
						value={Option.some(arrivalClockOf(feeder))}
						was={movedFrom(feeder.arrives, arrivalOf(feeder), feeder.to.timeZone)}
					/>
				)
			})}
			{!boarded && (
				<TimeRow
					chevron={false}
					label="Boarding"
					problem={Option.none()}
					size="plain"
					sub={Option.some(
						Option.match(gate, {onNone: Function.constant('gate not posted'), onSome: found => `gate ${found}`})
					)}
					value={Option.some(clockAt(boardsAt(props.flight), props.flight.from.timeZone))}
					was={Option.flatMap(props.flight.boardingAt, booked =>
						movedFrom(booked, boardsAt(props.flight), props.flight.from.timeZone)
					)}
				/>
			)}
			{!flown && (
				<TimeRow
					chevron={false}
					label="Departs"
					problem={Option.none()}
					size="plain"
					sub={Option.some(props.flight.from.name)}
					{...departureTimes(props.flight)}
				/>
			)}
			<TimeRow
				chevron={false}
				label="Lands"
				problem={Option.none()}
				size="plain"
				sub={Option.some(props.flight.to.name)}
				value={Option.some(arrivalClockOf(props.flight))}
				was={movedFrom(props.flight.arrives, arrivalOf(props.flight), props.flight.to.timeZone)}
			/>
		</>
	)
}

// The change to the next flight of the day, which opens it.
function NextRow(props: {flight: Flight; next: Flight; onOpen: (id: FlightId) => void}) {
	const change = changeWords(props.flight, props.next)
	return (
		<NativeButton onPress={() => props.onOpen(props.next.id)} modifiers={[buttonStyle('plain')]}>
			<TimeRow
				chevron
				label={change.label}
				problem={Option.liftPredicate('warn' as const, () => change.tight)}
				size="plain"
				sub={Option.some(`${titleOf(props.next)} to ${cityOf(props.next.to)}`)}
				value={Option.some(clockAt(departureOf(props.next), props.next.from.timeZone))}
				was={Option.none()}
			/>
		</NativeButton>
	)
}

function Travellers(props: {flight: Flight}) {
	if (Array.isReadonlyArrayEmpty(props.flight.travellers)) return undefined
	return (
		<Section title="Travellers">
			{Array.map(props.flight.travellers, (traveller, index) => (
				<TimeRow
					key={index}
					chevron={false}
					label={pipe(
						traveller.name,
						Option.map(name => Array.headNonEmpty(String.split(name, ' '))),
						Option.getOrElse(Function.constant('Traveller'))
					)}
					problem={Option.none()}
					size="plain"
					sub={Option.liftPredicate(
						line([
							Option.liftPredicate('Cancelled', () => traveller.status === 'cancelled'),
							labelled('Group', traveller.boardingGroup),
							traveller.confirmation
						]),
						String.isNonEmpty
					)}
					// A cancelled booking keeps its seat struck through, so who no longer flies reads apart without a warning.
					value={Option.filter(traveller.seat, () => traveller.status === 'confirmed')}
					was={Option.filter(traveller.seat, () => traveller.status === 'cancelled')}
				/>
			))}
		</Section>
	)
}

// The flight's day as it stands for this flight.
function useDay(flight: Flight, flights: FlightList) {
	const now = useAtomValue(nowAtom)
	const travel = pipe(useAtomValue(travelAtom), AsyncResult.value, Option.getOrElse(Array.empty<TravelTime>))
	const journey = Option.getOrElse(journeyOf(flights, flight), () => Array.of(flight) satisfies Journey)
	const index = pipe(
		journey,
		Array.findFirstIndex(item => item.id === flight.id),
		Option.getOrElse(Function.constant(0))
	)
	const current = stepOf(journey, now, travel)
	const feeder = pipe(
		journey,
		Array.get(index - 1),
		Option.filter(() => index > current.index)
	)
	return {
		current,
		feeder,
		// Its own step while the day is at it, the change to it while it is a connection still ahead, and its landing once it landed.
		hero: Option.match(feeder, {
			onNone: () =>
				Boolean.match(index < current.index, {
					onFalse: () => heroOf(journey, current, now, travel),
					onTrue: () => landedHero(flight)
				}),
			onSome: found => changeHero(found, flight)
		}),
		next: Array.get(journey, index + 1),
		now,
		// Directions, a ride and the trip there show while he still has to reach the first airport of the day.
		toAirport: index === 0 && current.index === 0 && (current.phase === 'leave' || current.phase === 'airport'),
		travel
	}
}

// The next step on top, the way to the airport while he still has to get there, the times still ahead, the change to the next flight, then who flies. On the board the flight's number heads its data, since the bar there has no title.
function FlightPage(props: {
	board: boolean
	flight: Flight
	flights: FlightList
	onOpen: (id: FlightId) => void
	size: HeroSize
}) {
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const day = useDay(props.flight, props.flights)
	return (
		<List
			modifiers={[
				listStyle('plain'),
				tint(primary),
				// A failed refresh already alerted, and the exit never rejects, so the pull ends either way.
				refreshable(async () => {
					await refresh(props.flight.id)
				})
			]}
		>
			<VStack
				alignment="leading"
				spacing={space[4]}
				modifiers={[listRowSeparator('hidden'), padding({vertical: space[2]})]}
			>
				{props.board && (
					<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{`${titleOf(props.flight)} · ${routeOf(props.flight)}`}
					</Text>
				)}
				<HeroView hero={day.hero} size={props.size} />
				{day.toAirport && bookedOf(props.flight) && <Rides flight={props.flight} />}
			</VStack>
			{day.toAirport && <TravelRow flight={props.flight} travel={day.travel} />}
			<Times current={day.current} feeder={day.feeder} flight={props.flight} now={day.now} />
			{Option.match(day.next, {
				onNone: Function.constNull,
				onSome: next => <NextRow flight={props.flight} next={next} onOpen={props.onOpen} />
			})}
			<Travellers flight={props.flight} />
		</List>
	)
}

// The flight number with its route and date under it, in the bar.
function Title(props: {flight: Flight}) {
	return (
		<ToolbarItem placement="principal">
			<VStack spacing={0}>
				<Text modifiers={[font({textStyle: 'headline'}), lineLimit(1)]}>{titleOf(props.flight)}</Text>
				<Text modifiers={[font({textStyle: 'caption'}), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
					{`${routeOf(props.flight)} · ${weekdayOf(DateTime.makeZonedUnsafe(departureOf(props.flight), {timeZone: props.flight.from.timeZone}))}`}
				</Text>
			</VStack>
		</ToolbarItem>
	)
}

// The change between the first two flights still ahead, read at a glance above a laptop's fold: how long, and the three times it hangs on.
function ChangeBoard(props: {feeder: Flight; next: Flight}) {
	return (
		<List modifiers={[listStyle('plain')]}>
			<VStack modifiers={[listRowSeparator('hidden'), padding({vertical: space[4]})]}>
				<HeroView hero={changeHero(props.feeder, props.next)} size="glance" />
			</VStack>
			<TimeRow
				chevron={false}
				label={`${titleOf(props.feeder)} lands`}
				problem={Option.none()}
				size="big"
				sub={Option.none()}
				value={Option.some(arrivalClockOf(props.feeder))}
				was={movedFrom(props.feeder.arrives, arrivalOf(props.feeder), props.feeder.to.timeZone)}
			/>
			<TimeRow
				chevron={false}
				label={`${titleOf(props.next)} boards`}
				problem={Option.none()}
				size="big"
				sub={Option.none()}
				value={Option.some(clockAt(boardsAt(props.next), props.next.from.timeZone))}
				was={Option.none()}
			/>
			<TimeRow
				chevron={false}
				label={`${titleOf(props.next)} departs`}
				problem={Option.none()}
				size="big"
				sub={Option.none()}
				value={Option.some(clockAt(departureOf(props.next), props.next.from.timeZone))}
				was={movedFrom(props.next.departs, departureOf(props.next), props.next.from.timeZone)}
			/>
		</List>
	)
}

// With nothing opened: flat like a book, the flight under way or next beside the day; half open like a laptop, the change between its flights above the fold, or that flight when it has none. Above the fold it has no Back.
function Board(props: {onOpen: (id: FlightId) => void}) {
	const tiled = useListTiled()
	const now = useAtomValue(nowAtom)
	const travel = pipe(useAtomValue(travelAtom), AsyncResult.value, Option.getOrElse(Array.empty<TravelTime>))
	const flights = pipe(useAtomValue(flightsAtom), AsyncResult.value, Option.getOrElse(Array.empty<Flight>))
	return Option.match(useAtomValue(boardAtom), {
		onNone: Function.constUndefined,
		onSome: flight => {
			const change = pipe(
				journeyOf(flights, flight),
				Option.filter(() => !tiled),
				Option.flatMap(journey => {
					const current = stepOf(journey, now, travel)
					return pipe(
						journey,
						Array.get(current.index + 1),
						Option.map(next => ({feeder: current.flight, next}))
					)
				})
			)
			return (
				<Toolbar
					modifiers={[
						// A board has no title in the bar: its flight's number heads its data, and the change belongs to no one flight.
						navigationTitle(''),
						navigationBarTitleDisplayMode('inline'),
						barNeverMinimizes(),
						...Boolean.match(tiled, {onFalse: () => [backHidden], onTrue: () => []})
					]}
				>
					{Option.match(change, {
						onNone: () => (
							<FlightPage
								board
								flight={flight}
								flights={flights}
								onOpen={props.onOpen}
								size={Boolean.match(tiled, {
									onFalse: Function.constant<HeroSize>('glance'),
									onTrue: Function.constant<HeroSize>('read')
								})}
							/>
						),
						onSome: found => <ChangeBoard feeder={found.feeder} next={found.next} />
					})}
				</Toolbar>
			)
		}
	})
}

// Beside the list the split view draws no Back, so the system close takes an opened flight away and brings the board back.
function Close(props: {onClose: () => void}) {
	if (!useListTiled()) return undefined
	return (
		<ToolbarItem placement="topBarLeading">
			<NativeButton role="close" onPress={props.onClose} />
		</ToolbarItem>
	)
}

// The opened flight, or with nothing opened the board, shown only while the window tiles, beside the list or in place of a hidden one, or while the list is below it.
export function FlightRoute(props: {
	flights: FlightList
	id: Option.Option<FlightId>
	offline: boolean
	onClose: () => void
	onOpen: (id: FlightId) => void
}) {
	const remove = useAtomSet(removal.removeAtom)
	const beside = useListBeside()
	const tiled = useListTiled()
	if (Option.isNone(props.id) && !beside && !tiled) return undefined
	return Option.match(props.id, {
		onNone: () => <Board onOpen={props.onOpen} />,
		onSome: id =>
			pipe(
				props.flights,
				Array.findFirst(flight => flight.id === id),
				Option.match({
					// Only a list the server answered says the flight is gone; a copy kept offline may predate it.
					onNone: () => (
						<Toolbar modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline')]}>
							<Empty>
								<EmptyMedia>
									{Boolean.match(props.offline, {
										onFalse: () => <Image systemName="trash" modifiers={[accessibilityLabel('Flight Deleted')]} />,
										onTrue: () => (
											<Image systemName="icloud.slash" modifiers={[accessibilityLabel('Flight Not Loaded')]} />
										)
									})}
								</EmptyMedia>
							</Empty>
							<Toolbar.Content>
								<Close onClose={props.onClose} />
							</Toolbar.Content>
						</Toolbar>
					),
					onSome: flight => (
						<Toolbar modifiers={[navigationTitle(titleOf(flight)), navigationBarTitleDisplayMode('inline')]}>
							<FlightPage board={false} flight={flight} flights={props.flights} onOpen={props.onOpen} size="read" />
							<Toolbar.Content>
								<Close onClose={props.onClose} />
								<Title flight={flight} />
								<ToolbarItem placement="topBarTrailing">
									<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
										<NativeButton
											label="Delete"
											systemImage="trash"
											role="destructive"
											onPress={() => {
												remove(flight.id)
												props.onClose()
											}}
										/>
									</Menu>
								</ToolbarItem>
							</Toolbar.Content>
						</Toolbar>
					)
				})
			)
	})
}
