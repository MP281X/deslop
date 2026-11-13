import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Duration, Function, Option, pipe} from 'effect'

import {
	Button,
	Divider,
	Form,
	HStack,
	LabeledContent,
	Menu,
	Section,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
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
import {AsyncResult} from 'effect/reactivity'

import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Empty} from '@deslop/components-mobile/ui/empty'

import {nowAtom, refreshAtom, removal} from '#lib/bookings.ts'
import {mapsAtom, placeLine, ridesOf, uberAtom} from '#lib/rides.ts'
import {dayAt, primary, problemOf, statusOf, tones} from '#lib/status.ts'
import {arrivalOf, clockAt, departureOf, MINUTE, routeOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, Stay, Tone, Train} from '#services/bookings/schema.ts'

function colorOf(tone?: Tone) {
	if (tone === undefined || tone === 'plain') return colors.foreground
	return tones[tone]
}

function toneIf(changed: boolean, tone: Tone) {
	if (changed) return tone
	return 'plain'
}

function Field(props: {label: string; tone?: Tone; value?: string}) {
	if (props.value === undefined) return undefined
	return (
		<LabeledContent label={props.label}>
			<Text modifiers={[text.data, foregroundStyle(colorOf(props.tone)), textSelection(true)]}>{props.value}</Text>
		</LabeledContent>
	)
}

function moved(scheduled: DateTime.Utc, current: DateTime.Utc, timeZone: string) {
	if (Duration.isLessThan(Duration.abs(DateTime.distance(scheduled, current)), MINUTE)) {
		return clockAt(scheduled, timeZone)
	}
	return `${clockAt(current, timeZone)} (${clockAt(scheduled, timeZone)})`
}

function FlightFields(props: {flight: Flight}) {
	return (
		<>
			<Section title={`Departure · ${props.flight.from.name}`}>
				<Field label="Date" value={dayAt(props.flight.departs, props.flight.from.timeZone)} />
				<Field
					label="Terminal"
					value={Option.getOrUndefined(Option.flatMap(props.flight.live, report => report.departureTerminal))}
				/>
				<Field
					label="Boarding"
					value={Option.getOrUndefined(
						Option.map(props.flight.boardingAt, at => clockAt(at, props.flight.from.timeZone))
					)}
				/>
			</Section>
			<Section title={`Arrival · ${props.flight.to.name}`}>
				<Field label="Arrives" value={moved(props.flight.arrives, arrivalOf(props.flight), props.flight.to.timeZone)} />
				<Field
					label="Terminal"
					value={Option.getOrUndefined(Option.flatMap(props.flight.live, report => report.arrivalTerminal))}
				/>
				<Field
					label="Gate"
					value={Option.getOrUndefined(Option.flatMap(props.flight.live, report => report.arrivalGate))}
				/>
				<Field
					label="Baggage belt"
					tone="good"
					value={Option.getOrUndefined(Option.flatMap(props.flight.live, report => report.belt))}
				/>
			</Section>
			<Section title="Booking">
				<Field label="Airline" value={props.flight.airline} />
				<Field label="Group" value={Option.getOrUndefined(props.flight.boardingGroup)} />
				<Field
					label="Aircraft"
					value={Option.getOrUndefined(Option.flatMap(props.flight.live, report => report.aircraft))}
				/>
				<Field label="Confirmation" value={Option.getOrUndefined(props.flight.confirmation)} />
			</Section>
		</>
	)
}

function TrainFields(props: {train: Train}) {
	return (
		<>
			<Section title={`Departure · ${props.train.from.name}`}>
				<Field label="Date" value={dayAt(props.train.departs, props.train.from.timeZone)} />
				<Field
					label="Last seen"
					value={Option.getOrUndefined(
						pipe(
							props.train.live,
							Option.flatMap(report => report.lastSeen),
							Option.map(seen => `${seen.station} at ${clockAt(seen.at, props.train.from.timeZone)}`)
						)
					)}
				/>
			</Section>
			<Section title={`Arrival · ${props.train.to.name}`}>
				<Field label="Arrives" value={moved(props.train.arrives, arrivalOf(props.train), props.train.to.timeZone)} />
				<Field
					label="Platform"
					value={Option.getOrUndefined(Option.flatMap(props.train.live, report => report.arrivalPlatform))}
				/>
			</Section>
			<Section title="Booking">
				<Field label="Train" value={props.train.operatorName} />
				<Field label="Confirmation" value={Option.getOrUndefined(props.train.confirmation)} />
			</Section>
		</>
	)
}

function StayFields(props: {stay: Stay}) {
	return (
		<Section title="Stay">
			<Field label="Address" value={Option.getOrUndefined(props.stay.place.address)} />
			<Field label="Confirmation" value={Option.getOrUndefined(props.stay.confirmation)} />
		</Section>
	)
}

function Essential(props: {label: string; tone?: Tone; value?: string}) {
	if (props.value === undefined) return undefined
	return (
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
				{props.value}
			</Text>
		</VStack>
	)
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
			value={clockAt(departureOf(props.journey), props.journey.from.timeZone)}
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
				value={pipe(
					props.flight.live,
					Option.flatMap(report =>
						Option.map(report.departureGate, gate =>
							Option.match(report.previousGate, {onNone: () => gate, onSome: previous => `${gate} (was ${previous})`})
						)
					),
					Option.getOrUndefined
				)}
			/>
			<Essential label="Seat" value={Option.getOrUndefined(props.flight.seat)} />
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
				value={Option.getOrUndefined(Option.flatMap(props.train.live, report => report.departurePlatform))}
			/>
			<Essential
				label="Seat"
				value={Option.getOrUndefined(
					Option.map(props.train.seat, seat =>
						Option.match(props.train.coach, {onNone: () => seat, onSome: coach => `${coach} · ${seat}`})
					)
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
				value={`${dayAt(props.stay.checkIn, props.stay.place.timeZone)} · ${clockAt(props.stay.checkIn, props.stay.place.timeZone)}`}
			/>
			<Essential
				label="Check-out"
				value={`${dayAt(props.stay.checkOut, props.stay.place.timeZone)} · ${clockAt(props.stay.checkOut, props.stay.place.timeZone)}`}
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

export function BookingRoute(props: {bookings: BookingList; id: Booking['id']; onClose: () => void}) {
	const remove = useAtomSet(removal.removeAtom)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), DateTime.nowUnsafe)
	return pipe(
		props.bookings,
		Array.findFirst(booking => booking.id === props.id),
		Option.match({
			onNone: () => (
				<Empty
					systemImage="trash"
					label="Booking Deleted"
					modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline')]}
				/>
			),
			onSome: booking => {
				const status = statusOf(booking, now)
				return (
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
											{routeOf(booking)}
										</Text>
										{Option.match(problemOf(booking, status, now), {
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
									{booking._tag === 'flight' && <FlightEssentials flight={booking} />}
									{booking._tag === 'train' && <TrainEssentials train={booking} />}
									{booking._tag === 'stay' && <StayEssentials stay={booking} />}
								</VStack>
							</Section>
							{booking._tag === 'flight' && <FlightFields flight={booking} />}
							{booking._tag === 'train' && <TrainFields train={booking} />}
							{booking._tag === 'stay' && <StayFields stay={booking} />}
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
											remove(props.id)
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
