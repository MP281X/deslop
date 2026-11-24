import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Option, Schema, pipe} from 'effect'

import {
	Button,
	Divider,
	Form,
	HStack,
	Image,
	LabeledContent,
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
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	minimumScaleFactor,
	font,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	refreshable,
	tag,
	textCase,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {useListBeside, useListTiled} from '@deslop/components-mobile/blocks/list-detail'
import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {backHidden, barNeverMinimizes} from '@deslop/components-mobile/lib/toolbar'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'

import {boardAtom, nowAtom, refreshAtom, removal} from '#lib/flights.ts'
import {mapsAtom, placeLine, uberAtom} from '#lib/rides.ts'
import {primary} from '#lib/session.ts'
import {dayAt, problemOf, statusOf, tones} from '#lib/status.ts'
import {setTravelAtom, TRAVEL_CHOICES, travelAtom, travelLabel} from '#lib/travel.ts'
import {
	airportByOf,
	arrivalClockOf,
	arrivalOf,
	bookedOf,
	clockAt,
	departureOf,
	labelled,
	leaveByOf,
	line,
	MINUTE,
	routeOf,
	titleOf,
	travellersLine,
	travelTo
} from '#services/flights/lib/utils.ts'
import type {FlightId, FlightList, Flight, Tone, TravelTime} from '#services/flights/schema.ts'

function colorOf(tone?: Tone) {
	if (tone === undefined || tone === 'plain') return colors.foreground
	return tones[tone]
}

function toneIf(changed: boolean, tone: Tone) {
	if (changed) return tone
	return 'plain'
}

function Field(props: {label: string; tone?: Tone; value: Option.Option<string>}) {
	return Option.match(props.value, {
		onNone: Function.constNull,
		onSome: value => (
			<LabeledContent label={props.label}>
				<Text modifiers={[text.data, foregroundStyle(colorOf(props.tone)), textSelection(true)]}>{value}</Text>
			</LabeledContent>
		)
	})
}

// The arrival with the days it lands after the departure's date, and the scheduled clock when it moved.
function arrives(flight: Flight) {
	if (Duration.isLessThan(Duration.abs(DateTime.distance(flight.arrives, arrivalOf(flight))), MINUTE)) {
		return arrivalClockOf(flight)
	}
	return `${arrivalClockOf(flight)} (${clockAt(flight.arrives, flight.to.timeZone)})`
}

function FlightFields(props: {flight: Flight}) {
	return (
		<>
			<Section title={`Departure · ${props.flight.from.name}`}>
				<Field label="Date" value={Option.some(dayAt(props.flight.departs, props.flight.from.timeZone))} />
				<Field label="Terminal" value={Option.flatMap(props.flight.live, report => report.departureTerminal)} />
				<Field
					label="Boarding"
					value={Option.map(props.flight.boardingAt, at => clockAt(at, props.flight.from.timeZone))}
				/>
			</Section>
			<Section title={`Arrival · ${props.flight.to.name}`}>
				<Field label="Arrives" value={Option.some(arrives(props.flight))} />
			</Section>
			<Section title="Booking">
				<Field label="Airline" value={Option.some(props.flight.airline)} />
				<Field label="Aircraft" value={Option.flatMap(props.flight.live, report => report.aircraft)} />
			</Section>
			{Array.isReadonlyArrayNonEmpty(props.flight.travellers) && (
				<Section title="Travellers">
					{Array.map(props.flight.travellers, (traveller, index) => (
						<Field
							key={index}
							label={Option.getOrElse(traveller.name, Function.constant('Traveller'))}
							tone={toneIf(traveller.status === 'cancelled', 'bad')}
							value={Option.some(
								line([
									Option.liftPredicate('Cancelled', () => traveller.status === 'cancelled'),
									traveller.seat,
									labelled('Group', traveller.boardingGroup),
									traveller.confirmation
								])
							)}
						/>
					))}
				</Section>
			)}
		</>
	)
}

// A field's value at reading size in the flight, and at glance size on the board.
type Size = typeof Size.Type
const Size = Schema.Literals(['glance', 'read'])

// At glance size a value shrinks to its column rather than break, as a clock would between its digits on a book's half.
const valueStyles = {
	glance: [
		font({design: 'monospaced', textStyle: 'largeTitle', weight: 'semibold'}),
		lineLimit(1),
		minimumScaleFactor(0.5)
	],
	read: [font({design: 'monospaced', textStyle: 'headline', weight: 'semibold'})]
}

function Essential(props: {label: string; size: Size; tone?: Tone; value: Option.Option<string>}) {
	return Option.match(props.value, {
		onNone: Function.constNull,
		onSome: value => (
			<VStack alignment="leading" spacing={space[1]} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
				<Text modifiers={[text.label, textCase('uppercase'), foregroundStyle(colors.mutedForeground)]}>
					{props.label}
				</Text>
				<Text modifiers={[...valueStyles[props.size], foregroundStyle(colorOf(props.tone))]}>{value}</Text>
			</VStack>
		)
	})
}

function Departs(props: {flight: Flight; size: Size}) {
	return (
		<Essential
			label="Departs"
			size={props.size}
			tone={toneIf(
				pipe(
					props.flight.departs,
					DateTime.distance(departureOf(props.flight)),
					Duration.isGreaterThanOrEqualTo(Duration.minutes(5))
				),
				'warn'
			)}
			value={Option.some(clockAt(departureOf(props.flight), props.flight.from.timeZone))}
		/>
	)
}

function FlightEssentials(props: {flight: Flight; size: Size}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Departs flight={props.flight} size={props.size} />
			<Essential
				label="Gate"
				size={props.size}
				tone={toneIf(
					Option.exists(props.flight.live, report => Option.isSome(report.previousGate)),
					'warn'
				)}
				value={Option.flatMap(props.flight.live, report =>
					Option.map(report.departureGate, gate =>
						Option.match(report.previousGate, {onNone: () => gate, onSome: previous => `${gate} (was ${previous})`})
					)
				)}
			/>
			<Essential label="Seat" size={props.size} value={travellersLine(props.flight, traveller => traveller.seat)} />
		</HStack>
	)
}

// When to leave and be at the airport, the trip there as saved for its airport, and directions and a ride to it.
function Rides(props: {flight: Flight}) {
	const maps = useAtomSet(mapsAtom)
	const uber = useAtomSet(uberAtom)
	const setTravel = useAtomSet(setTravelAtom)
	const travel = pipe(useAtomValue(travelAtom), AsyncResult.value, Option.getOrElse(Array.empty<TravelTime>))
	return (
		<Section title={`To ${props.flight.from.name}`}>
			<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>{placeLine(props.flight.from)}</Text>
			<Field
				label="Leave by"
				value={Option.map(leaveByOf(props.flight, travel), at => clockAt(at, props.flight.from.timeZone))}
			/>
			<Field label="Airport by" value={Option.some(clockAt(airportByOf(props.flight), props.flight.from.timeZone))} />
			{Option.match(props.flight.from.code, {
				onNone: Function.constNull,
				onSome: airport => (
					<Picker<number>
						label="Trip to the airport"
						selection={pipe(
							travelTo(props.flight, travel),
							Option.map(Duration.toMinutes),
							Option.getOrElse(Function.constant(0))
						)}
						onSelectionChange={minutes => {
							if (minutes > 0) setTravel({airport, minutes})
						}}
					>
						{Option.isNone(travelTo(props.flight, travel)) && <Text modifiers={[tag(0)]}>Not Set</Text>}
						{Array.map(TRAVEL_CHOICES, minutes => (
							<Text key={minutes} modifiers={[tag(minutes)]}>
								{travelLabel(minutes)}
							</Text>
						))}
					</Picker>
				)
			})}
			<Button label="Directions in Maps" systemImage="map" onPress={() => maps(props.flight.from)} />
			<Button label="Ride with Uber" systemImage="car" onPress={() => uber(props.flight.from)} />
		</Section>
	)
}

const headingFonts = {
	glance: {problem: font({textStyle: 'title2', weight: 'semibold'}), route: text.display},
	read: {problem: text.title, route: font({textStyle: 'title2', weight: 'bold'})}
}

// Where the flight goes, and its problem with a dot.
function Heading(props: {flight: Flight; now: DateTime.Utc; size: Size}) {
	return (
		<VStack alignment="leading" spacing={space[2]}>
			<Text modifiers={[headingFonts[props.size].route, foregroundStyle(colors.foreground)]}>
				{routeOf(props.flight)}
			</Text>
			{Option.match(problemOf(props.flight, statusOf(props.flight, props.now), props.now), {
				onNone: Function.constUndefined,
				onSome: problem => (
					<HStack spacing={space[2]}>
						<StatusDot status={problem.status} />
						<Text modifiers={[headingFonts[props.size].problem, foregroundStyle(tones[problem.tone])]}>
							{problem.label}
						</Text>
					</HStack>
				)
			})}
		</VStack>
	)
}

// The flight under way or next, read at a glance from a tray table, its number among its own data rather than as a title. Half open like a laptop it stands above the list, so it has no Back. With no flight coming up the list's own state says so, and nothing stands beside it.
function Board() {
	const now = useAtomValue(nowAtom)
	const tiled = useListTiled()
	return Option.match(useAtomValue(boardAtom), {
		onNone: Function.constUndefined,
		onSome: flight => (
			<VStack
				alignment="leading"
				spacing={space[6]}
				modifiers={[
					navigationBarTitleDisplayMode('inline'),
					barNeverMinimizes(),
					...Boolean.match(tiled, {onFalse: () => [backHidden], onTrue: () => []}),
					padding({horizontal: space[6]}),
					frame({alignment: 'leading', maxHeight: Infinity, maxWidth: Infinity})
				]}
			>
				<VStack alignment="leading" spacing={space[2]}>
					<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>{titleOf(flight)}</Text>
					<Heading flight={flight} now={now} size="glance" />
				</VStack>
				<FlightEssentials flight={flight} size="glance" />
			</VStack>
		)
	})
}

// Beside the list the split view draws no Back, so the system close takes an opened flight away and brings the board back.
function Close(props: {onClose: () => void}) {
	if (!useListTiled()) return undefined
	return (
		<ToolbarItem placement="topBarLeading">
			<Button role="close" onPress={props.onClose} />
		</ToolbarItem>
	)
}

// The opened flight, or with nothing opened the board, shown only while the window tiles, beside the list or in place of a hidden one, or while the list is below it.
export function FlightRoute(props: {
	flights: FlightList
	id: Option.Option<FlightId>
	offline: boolean
	onClose: () => void
}) {
	const remove = useAtomSet(removal.removeAtom)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = useAtomValue(nowAtom)
	const beside = useListBeside()
	const tiled = useListTiled()
	if (Option.isNone(props.id) && !beside && !tiled) return undefined
	return Option.match(props.id, {
		onNone: () => <Board />,
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
							<Form
								modifiers={[
									tint(primary),
									// A failed refresh already alerted, and the exit never rejects, so the pull ends either way.
									refreshable(async () => {
										await refresh(flight.id)
									})
								]}
							>
								<Section>
									<VStack
										alignment="leading"
										spacing={space[3]}
										modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}
									>
										<Heading flight={flight} now={now} size="read" />
										<Divider />
										<FlightEssentials flight={flight} size="read" />
									</VStack>
								</Section>
								<FlightFields flight={flight} />
								{bookedOf(flight) && <Rides flight={flight} />}
							</Form>
							<Toolbar.Content>
								<Close onClose={props.onClose} />
								<ToolbarItem placement="topBarTrailing">
									<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
										<Button
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
