import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Option, pipe} from 'effect'

import {
	Button,
	Divider,
	Form,
	HStack,
	Image,
	LabeledContent,
	Menu,
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
	font,
	navigationBarTitleDisplayMode,
	navigationTitle,
	refreshable,
	textCase,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {Fragment} from 'react'

import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'

import {journeyKey, nowAtom, refreshAtom, removal, startAtom} from '#lib/bookings.ts'
import {mapsAtom, placeLine, ridesOf, uberAtom} from '#lib/rides.ts'
import {primary} from '#lib/session.ts'
import {currentOf, dayAt, problemOf, statusOf, tones} from '#lib/status.ts'
import {
	arrivalClockOf,
	arrivalOf,
	autoStartOf,
	changeOf,
	clockAt,
	departureOf,
	journeysOf,
	MINUTE,
	routeOf,
	startable,
	titleOf
} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'
import type {BookedPlace, BookingList, Flight, Stay, Tone, Train} from '#services/bookings/schema.ts'

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
function arrives(journey: Flight | Train) {
	if (Duration.isLessThan(Duration.abs(DateTime.distance(journey.arrives, arrivalOf(journey))), MINUTE)) {
		return arrivalClockOf(journey)
	}
	return `${arrivalClockOf(journey)} (${clockAt(journey.arrives, journey.to.timeZone)})`
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
				<Field label="Terminal" value={Option.flatMap(props.flight.live, report => report.arrivalTerminal)} />
				<Field label="Gate" value={Option.flatMap(props.flight.live, report => report.arrivalGate)} />
				<Field label="Baggage belt" tone="good" value={Option.flatMap(props.flight.live, report => report.belt)} />
			</Section>
			<Section title="Booking">
				<Field label="Airline" value={Option.some(props.flight.airline)} />
				<Field label="Group" value={props.flight.boardingGroup} />
				<Field label="Aircraft" value={Option.flatMap(props.flight.live, report => report.aircraft)} />
				<Field label="Confirmation" value={props.flight.confirmation} />
			</Section>
		</>
	)
}

function TrainTimes(props: {train: Train}) {
	return (
		<>
			<Section title={`Departure · ${props.train.from.name}`}>
				<Field label="Date" value={Option.some(dayAt(props.train.departs, props.train.from.timeZone))} />
				<Field
					label="Last seen"
					value={pipe(
						props.train.live,
						Option.flatMap(report => report.lastSeen),
						Option.map(seen => `${seen.station} at ${clockAt(seen.at, props.train.from.timeZone)}`)
					)}
				/>
			</Section>
			<Section title={`Arrival · ${props.train.to.name}`}>
				<Field label="Arrives" value={Option.some(arrives(props.train))} />
				<Field label="Platform" value={Option.flatMap(props.train.live, report => report.arrivalPlatform)} />
			</Section>
		</>
	)
}

function Stops(props: {train: Train}) {
	const last = props.train.stops.length - 1
	return (
		<Section title={`${props.train.service} · ${dayAt(props.train.departs, props.train.from.timeZone)}`}>
			{Array.map(props.train.stops, (stop, index) => {
				const end = index === 0 || index === last
				// Where the train leaves a stop; the last stop shows where it arrives.
				const time = pipe(
					Boolean.match(index === last, {
						onFalse: () => Option.orElse(stop.departs, () => stop.arrives),
						onTrue: () => Option.orElse(stop.arrives, () => stop.departs)
					}),
					// Each stop in its own zone, since a train can cross one.
					Option.map(at =>
						clockAt(
							at,
							Option.getOrElse(stop.timeZone, () => props.train.from.timeZone)
						)
					),
					Option.getOrElse(Function.constant(''))
				)
				return (
					<HStack key={`${index}-${stop.name}`} spacing={space[3]}>
						<Text
							modifiers={[
								text.data,
								foregroundStyle(
									Boolean.match(end, {onFalse: () => colors.mutedForeground, onTrue: () => colors.foreground})
								),
								frame({minWidth: 44})
							]}
						>
							{time}
						</Text>
						<Text
							modifiers={[
								Boolean.match(end, {onFalse: () => text.body, onTrue: () => text.row}),
								foregroundStyle(colors.foreground)
							]}
						>
							{stop.name}
						</Text>
					</HStack>
				)
			})}
		</Section>
	)
}

function Change(props: {from: Train; to: Train}) {
	return (
		<Section>
			<HStack spacing={space[2]}>
				<Image systemName="arrow.triangle.swap" modifiers={[foregroundStyle(colors.mutedForeground)]} />
				<Text modifiers={[text.detail, foregroundStyle(colors.mutedForeground)]}>{changeOf(props.from, props.to)}</Text>
			</HStack>
		</Section>
	)
}

function Trains(props: {trains: readonly Train[]}) {
	const confirmation = Array.findFirst(props.trains, train => train.confirmation)
	return (
		<>
			{Array.map(props.trains, (train, index) => (
				<Fragment key={train.id}>
					{Boolean.match(Array.isReadonlyArrayEmpty(train.stops), {
						onFalse: () => <Stops train={train} />,
						onTrue: () => <TrainTimes train={train} />
					})}
					{pipe(
						props.trains,
						Array.get(index + 1),
						Option.match({onNone: Function.constUndefined, onSome: next => <Change from={train} to={next} />})
					)}
				</Fragment>
			))}
			{Option.match(confirmation, {
				onNone: Function.constUndefined,
				onSome: found => (
					<Section title="Booking">
						<Field label="Confirmation" value={Option.some(found)} />
					</Section>
				)
			})}
		</>
	)
}

function StayFields(props: {stay: Stay}) {
	return (
		<Section title="Stay">
			<Field label="Address" value={props.stay.place.address} />
			<Field label="Confirmation" value={props.stay.confirmation} />
		</Section>
	)
}

function Essential(props: {label: string; tone?: Tone; value: Option.Option<string>}) {
	return Option.match(props.value, {
		onNone: Function.constNull,
		onSome: value => (
			<VStack alignment="leading" spacing={space[1]} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
				<Text modifiers={[text.label, textCase('uppercase'), foregroundStyle(colors.mutedForeground)]}>
					{props.label}
				</Text>
				<Text
					modifiers={[
						font({design: 'monospaced', textStyle: 'headline', weight: 'semibold'}),
						foregroundStyle(colorOf(props.tone))
					]}
				>
					{value}
				</Text>
			</VStack>
		)
	})
}

function Departs(props: {journey: Flight | Train}) {
	return (
		<Essential
			label="Departs"
			tone={toneIf(
				pipe(
					props.journey.departs,
					DateTime.distance(departureOf(props.journey)),
					Duration.isGreaterThanOrEqualTo(Duration.minutes(5))
				),
				'warn'
			)}
			value={Option.some(clockAt(departureOf(props.journey), props.journey.from.timeZone))}
		/>
	)
}

function FlightEssentials(props: {flight: Flight}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Departs journey={props.flight} />
			<Essential
				label="Gate"
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
			<Essential label="Seat" value={props.flight.seat} />
		</HStack>
	)
}

function TrainEssentials(props: {train: Train}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Departs journey={props.train} />
			<Essential
				label="Platform"
				tone={toneIf(
					Option.exists(props.train.live, report =>
						Option.exists(
							report.departurePlatformPlanned,
							planned => !Option.contains(report.departurePlatform, planned)
						)
					),
					'warn'
				)}
				value={Option.flatMap(props.train.live, report => report.departurePlatform)}
			/>
			<Essential
				label="Seat"
				value={Option.map(props.train.seat, seat =>
					Option.match(props.train.coach, {onNone: () => seat, onSome: coach => `${coach} · ${seat}`})
				)}
			/>
		</HStack>
	)
}

function StayEssentials(props: {stay: Stay}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Essential
				label="Check-in"
				value={Option.some(
					`${dayAt(props.stay.checkIn, props.stay.place.timeZone)} · ${clockAt(props.stay.checkIn, props.stay.place.timeZone)}`
				)}
			/>
			<Essential
				label="Check-out"
				value={Option.some(
					`${dayAt(props.stay.checkOut, props.stay.place.timeZone)} · ${clockAt(props.stay.checkOut, props.stay.place.timeZone)}`
				)}
			/>
		</HStack>
	)
}

function Rides(props: {booking: Booking; bookings: BookingList; now: DateTime.Utc}) {
	const maps = useAtomSet(mapsAtom)
	const uber = useAtomSet(uberAtom)
	return (
		<>
			{Array.map(ridesOf(props.booking, props.bookings, props.now), ride => (
				<Section key={ride.label} title={`To ${ride.label}`}>
					<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>{placeLine(ride.place)}</Text>
					<Button label="Directions in Maps" systemImage="map" onPress={() => maps(ride)} />
					<Button label="Ride with Uber" systemImage="car" onPress={() => uber(ride)} />
				</Section>
			))}
		</>
	)
}

function placeCity(place: BookedPlace) {
	return Option.getOrElse(place.city, () => place.name)
}

function routeOfJourney(journey: Array.NonEmptyReadonlyArray<Booking>) {
	const first = Array.headNonEmpty(journey)
	if (Booking.isAnyOf(['stay'])(first)) return routeOf(first)
	const last = Option.getOrElse(Array.last(Array.filter(journey, Booking.isAnyOf(['flight', 'train']))), () => first)
	return `${placeCity(first.from)} → ${placeCity(last.to)}`
}

function Start(props: {legs: readonly (Flight | Train)[]; now: DateTime.Utc}) {
	const start = useAtomSet(startAtom)
	if (!startable(props.legs, props.now)) return undefined
	const first = Array.headNonEmpty(props.legs)
	const auto = autoStartOf(props.legs)
	return (
		<Section
			footer={pipe(
				props.now,
				DateTime.isLessThan(auto),
				Boolean.match({
					onFalse: Function.constUndefined,
					onTrue: () => (
						<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>
							{`Starts by itself at ${clockAt(auto, first.from.timeZone)}.`}
						</Text>
					)
				})
			)}
		>
			<Button label="Start Live Activity" systemImage="play.fill" onPress={() => start(first.id)} />
		</Section>
	)
}

export function BookingRoute(props: {bookings: BookingList; id: Booking['id']; offline: boolean; onClose: () => void}) {
	const remove = useAtomSet(removal.removeAtom)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = useAtomValue(nowAtom)
	return pipe(
		journeysOf(props.bookings),
		Array.findFirst(journey => Array.some(journey, leg => leg.id === props.id)),
		Option.match({
			// Only a list the server answered says the booking is gone; a copy kept offline may predate it.
			onNone: () => (
				<Empty modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline')]}>
					<EmptyMedia>
						{Boolean.match(props.offline, {
							onFalse: () => <Image systemName="trash" modifiers={[accessibilityLabel('Booking Deleted')]} />,
							onTrue: () => <Image systemName="icloud.slash" modifiers={[accessibilityLabel('Booking Not Loaded')]} />
						})}
					</EmptyMedia>
				</Empty>
			),
			onSome: journey => {
				const booking = currentOf(journey, now)
				const legs = Array.filter(journey, Booking.isAnyOf(['flight', 'train']))
				return (
					<Toolbar
						modifiers={[
							navigationTitle(pipe(journey, Array.map(titleOf), Array.join(' · '))),
							navigationBarTitleDisplayMode('inline')
						]}
					>
						<Form
							modifiers={[
								tint(primary),
								// A failed refresh already alerted, and the exit never rejects, so the pull ends either way.
								refreshable(async () => {
									await refresh(booking.id)
								})
							]}
						>
							<Section>
								<VStack
									alignment="leading"
									spacing={space[3]}
									modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}
								>
									<VStack alignment="leading" spacing={space[2]}>
										<Text modifiers={[font({textStyle: 'title2', weight: 'bold'}), foregroundStyle(colors.foreground)]}>
											{routeOfJourney(journey)}
										</Text>
										{pipe(
											journey,
											Array.findFirst(leg => problemOf(leg, statusOf(leg, now), now)),
											Option.match({
												onNone: Function.constUndefined,
												onSome: problem => (
													<HStack spacing={space[2]}>
														<StatusDot status={problem.status} />
														<Text modifiers={[text.title, foregroundStyle(tones[problem.tone])]}>{problem.label}</Text>
													</HStack>
												)
											})
										)}
									</VStack>
									<Divider />
									{Booking.isAnyOf(['flight'])(booking) && <FlightEssentials flight={booking} />}
									{Booking.isAnyOf(['train'])(booking) && <TrainEssentials train={booking} />}
									{Booking.isAnyOf(['stay'])(booking) && <StayEssentials stay={booking} />}
								</VStack>
							</Section>
							<Start legs={legs} now={now} />
							{Booking.isAnyOf(['flight'])(booking) && <FlightFields flight={booking} />}
							<Trains trains={Array.filter(journey, Booking.isAnyOf(['train']))} />
							{Booking.isAnyOf(['stay'])(booking) && <StayFields stay={booking} />}
							{booking.status === 'confirmed' && <Rides booking={booking} bookings={props.bookings} now={now} />}
						</Form>
						<Toolbar.Content>
							<ToolbarItem placement="topBarTrailing">
								<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
									<Button
										label="Delete"
										systemImage="trash"
										role="destructive"
										onPress={() => {
											remove(journeyKey(journey))
											props.onClose()
										}}
									/>
								</Menu>
							</ToolbarItem>
						</Toolbar.Content>
					</Toolbar>
				)
			}
		})
	)
}
