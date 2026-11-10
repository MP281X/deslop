import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Option} from 'effect'

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
import {mapsAtom, placeLine, ridesFor, uberAtom} from '#lib/rides.ts'
import {dayAt, primary, problemOf, statusOf, timeAt, tones} from '#lib/status.ts'
import {arrivalOf, departureOf, MINUTE, routeOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, FlightTracking, Stay, Tone, Train} from '#services/bookings/schema.ts'

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

function moved(scheduled: number, current: number, timeZone: string) {
	if (Math.abs(current - scheduled) < MINUTE) return timeAt(scheduled, timeZone)
	return `${timeAt(current, timeZone)} (${timeAt(scheduled, timeZone)})`
}

function gateOf(live?: FlightTracking) {
	if (live?.departureGate === undefined) return undefined
	if (live.previousGate === undefined) return live.departureGate
	return `${live.departureGate} (was ${live.previousGate})`
}

function FlightFields(props: {flight: Flight}) {
	return (
		<>
			<Section title={`Departure · ${props.flight.from.name}`}>
				<Field label="Date" value={dayAt(props.flight.departs, props.flight.from.timeZone)} />
				<Field label="Terminal" value={props.flight.live?.departureTerminal} />
				<Field
					label="Boarding"
					value={Option.getOrUndefined(
						Option.map(Option.fromUndefinedOr(props.flight.boardingAt), at => timeAt(at, props.flight.from.timeZone))
					)}
				/>
			</Section>
			<Section title={`Arrival · ${props.flight.to.name}`}>
				<Field label="Arrives" value={moved(props.flight.arrives, arrivalOf(props.flight), props.flight.to.timeZone)} />
				<Field label="Terminal" value={props.flight.live?.arrivalTerminal} />
				<Field label="Gate" value={props.flight.live?.arrivalGate} />
				<Field label="Baggage belt" tone="good" value={props.flight.live?.belt} />
			</Section>
			<Section title="Booking">
				<Field label="Airline" value={props.flight.airline} />
				<Field label="Group" value={props.flight.boardingGroup} />
				<Field label="Aircraft" value={props.flight.live?.aircraft} />
				<Field label="Confirmation" value={props.flight.confirmation} />
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
						Option.map(
							Option.fromUndefinedOr(props.train.live?.lastSeen),
							seen => `${seen.station} at ${timeAt(seen.at, props.train.from.timeZone)}`
						)
					)}
				/>
			</Section>
			<Section title={`Arrival · ${props.train.to.name}`}>
				<Field label="Arrives" value={moved(props.train.arrives, arrivalOf(props.train), props.train.to.timeZone)} />
				<Field label="Platform" value={props.train.live?.arrivalPlatform} />
			</Section>
			<Section title="Booking">
				<Field label="Train" value={props.train.operatorName} />
				<Field label="Coach" value={props.train.coach} />
				<Field label="Confirmation" value={props.train.confirmation} />
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
			tone={toneIf(departureOf(props.journey) - props.journey.departs >= 5 * MINUTE, 'warn')}
			value={timeAt(departureOf(props.journey), props.journey.from.timeZone)}
		/>
	)
}

function FlightEssentials(props: {flight: Flight}) {
	return (
		<HStack alignment="top" spacing={space[3]}>
			<Departs journey={props.flight} />
			<Essential
				label="Gate"
				tone={toneIf(props.flight.live?.previousGate !== undefined, 'warn')}
				value={gateOf(props.flight.live)}
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
					props.train.live?.departurePlatformPlanned !== undefined &&
						props.train.live.departurePlatform !== props.train.live.departurePlatformPlanned,
					'warn'
				)}
				value={props.train.live?.departurePlatform}
			/>
			<Essential
				label="Seat"
				value={Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(props.train.seat), seat =>
						Option.match(Option.fromUndefinedOr(props.train.coach), {
							onNone: () => seat,
							onSome: coach => `${coach} · ${seat}`
						})
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
				value={`${dayAt(props.stay.checkIn, props.stay.place.timeZone)} · ${timeAt(props.stay.checkIn, props.stay.place.timeZone)}`}
			/>
			<Essential
				label="Check-out"
				value={`${dayAt(props.stay.checkOut, props.stay.place.timeZone)} · ${timeAt(props.stay.checkOut, props.stay.place.timeZone)}`}
			/>
		</HStack>
	)
}

function Rides(props: {booking: Booking; bookings: BookingList; now: number}) {
	const maps = useAtomSet(mapsAtom)
	const uber = useAtomSet(uberAtom)
	return (
		<>
			{Array.map(ridesFor(props.booking, props.bookings, props.now), ride => (
				<Section key={ride.label} title={`To ${ride.label}`}>
					<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>{placeLine(ride.place)}</Text>
					<Button label="Directions in Maps" systemImage="map" onPress={() => maps(ride)} />
					<Button label="Ride with Uber" systemImage="car" onPress={() => uber(ride)} />
				</Section>
			))}
		</>
	)
}

export function BookingRoute(props: {bookings: BookingList; id: string; onClose: () => void}) {
	const remove = useAtomSet(removal(props.id).send)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	return Option.match(
		Array.findFirst(props.bookings, booking => booking.id === props.id),
		{
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
											onNone: () => undefined,
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
											remove({_tag: 'Removed'})
											props.onClose()
										}}
									/>
								</Menu>
							</ToolbarItem>
						</Toolbar.Content>
					</Toolbar>
				)
			}
		}
	)
}
