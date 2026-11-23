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

import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'

import {nowAtom, refreshAtom, removal, startAtom} from '#lib/bookings.ts'
import {mapsAtom, placeLine, ridesOf, uberAtom} from '#lib/rides.ts'
import {primary} from '#lib/session.ts'
import {dayAt, problemOf, statusOf, tones} from '#lib/status.ts'
import {
	arrivalClockOf,
	arrivalOf,
	autoStartOf,
	clockAt,
	departureOf,
	MINUTE,
	routeOf,
	startable,
	titleOf
} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'
import type {BookingList, Flight, Place, Stay, Tone} from '#services/bookings/schema.ts'

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

function Departs(props: {flight: Flight}) {
	return (
		<Essential
			label="Departs"
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

function FlightEssentials(props: {flight: Flight}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Departs flight={props.flight} />
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

function placeCity(place: Place) {
	return Option.getOrElse(place.city, () => place.name)
}

function routeOfBooking(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) return routeOf(booking)
	return `${placeCity(booking.from)} → ${placeCity(booking.to)}`
}

function Start(props: {flight: Flight; now: DateTime.Utc}) {
	const start = useAtomSet(startAtom)
	if (!startable(props.flight, props.now)) return undefined
	const auto = autoStartOf(props.flight)
	return (
		<Section
			footer={pipe(
				props.now,
				DateTime.isLessThan(auto),
				Boolean.match({
					onFalse: Function.constUndefined,
					onTrue: () => (
						<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>
							{`Starts by itself at ${clockAt(auto, props.flight.from.timeZone)}.`}
						</Text>
					)
				})
			)}
		>
			<Button label="Start Live Activity" systemImage="play.fill" onPress={() => start(props.flight.id)} />
		</Section>
	)
}

export function BookingRoute(props: {bookings: BookingList; id: Booking['id']; offline: boolean; onClose: () => void}) {
	const remove = useAtomSet(removal.removeAtom)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = useAtomValue(nowAtom)
	return pipe(
		props.bookings,
		Array.findFirst(booking => booking.id === props.id),
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
			onSome: booking => (
				<Toolbar modifiers={[navigationTitle(titleOf(booking)), navigationBarTitleDisplayMode('inline')]}>
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
										{routeOfBooking(booking)}
									</Text>
									{Option.match(problemOf(booking, statusOf(booking, now), now), {
										onNone: Function.constUndefined,
										onSome: problem => (
											<HStack spacing={space[2]}>
												<StatusDot status={problem.status} />
												<Text modifiers={[text.title, foregroundStyle(tones[problem.tone])]}>{problem.label}</Text>
											</HStack>
										)
									})}
								</VStack>
								<Divider />
								{Booking.isAnyOf(['flight'])(booking) && <FlightEssentials flight={booking} />}
								{Booking.isAnyOf(['stay'])(booking) && <StayEssentials stay={booking} />}
							</VStack>
						</Section>
						{Booking.isAnyOf(['flight'])(booking) && <Start flight={booking} now={now} />}
						{Booking.isAnyOf(['flight'])(booking) && <FlightFields flight={booking} />}
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
										remove(booking.id)
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
}
