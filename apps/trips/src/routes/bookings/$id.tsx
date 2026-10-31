import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Option} from 'effect'

import {
	Button,
	ContentUnavailableView,
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
	background,
	foregroundStyle,
	frame,
	labelStyle,
	font,
	lineLimit,
	navigationBarTitleDisplayMode,
	navigationTitle,
	refreshable,
	scrollContentBackground,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {colors, text} from '@deslop/components-mobile/theme'

import {
	dayAt,
	mapsAtom,
	nowAtom,
	placeLine,
	primary,
	refreshAtom,
	removeAtom,
	ridesFor,
	statusOf,
	timeAt,
	tones,
	uberAtom
} from '#lib/utils.ts'
import {arrivalOf, departureOf, isStale, MINUTE, routeOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, FlightTracking, Stay, Tone, Train} from '#services/bookings/schema.ts'

// A changed value reads in its tone; everything else in the text colour.
function colorOf(tone?: Tone) {
	if (tone === undefined || tone === 'plain') return colors.foreground
	return tones[tone]
}

function toneIf(changed: boolean, tone: Tone) {
	if (changed) return tone
	return 'plain'
}

// A value with its label, or nothing when the booking does not know it.
function Field(props: {label: string; tone?: Tone; value?: string}) {
	if (props.value === undefined) return undefined
	return (
		<LabeledContent label={props.label}>
			<Text modifiers={[text.data, foregroundStyle(colorOf(props.tone)), textSelection(true)]}>{props.value}</Text>
		</LabeledContent>
	)
}

// "16:40", or "17:05 (16:40)" once the provider moved it.
function moved(scheduled: number, current: number, timeZone?: string) {
	if (Math.abs(current - scheduled) < MINUTE) return timeAt(scheduled, timeZone)
	return `${timeAt(current, timeZone)} (${timeAt(scheduled, timeZone)})`
}

// "B12 (was B7)" after a gate change.
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
				<Field
					label="Departs"
					tone={toneIf(departureOf(props.flight) - props.flight.departs >= 15 * MINUTE, 'warn')}
					value={moved(props.flight.departs, departureOf(props.flight), props.flight.from.timeZone)}
				/>
				<Field label="Terminal" value={props.flight.live?.departureTerminal} />
				<Field
					label="Gate"
					tone={toneIf(props.flight.live?.previousGate !== undefined, 'warn')}
					value={gateOf(props.flight.live)}
				/>
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
				<Field label="Seat" value={props.flight.seat} />
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
					label="Departs"
					tone={toneIf((props.train.live?.delayMinutes ?? 0) >= 5, 'warn')}
					value={moved(props.train.departs, departureOf(props.train), props.train.from.timeZone)}
				/>
				<Field
					label="Platform"
					tone={toneIf(
						props.train.live?.departurePlatformPlanned !== undefined &&
							props.train.live.departurePlatform !== props.train.live.departurePlatformPlanned,
						'warn'
					)}
					value={props.train.live?.departurePlatform}
				/>
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
			<Section
				title="Booking"
				footer={
					props.train.operator !== 'trenitalia' && (
						<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>
							Live delays and platforms come from Trenitalia; this train shows its timetable.
						</Text>
					)
				}
			>
				<Field label="Train" value={props.train.operatorName} />
				<Field label="Coach" value={props.train.coach} />
				<Field label="Seat" value={props.train.seat} />
				<Field label="Confirmation" value={props.train.confirmation} />
			</Section>
		</>
	)
}

function StayFields(props: {stay: Stay}) {
	return (
		<Section title="Stay">
			<Field
				label="Check-in"
				value={`${dayAt(props.stay.checkIn, props.stay.place.timeZone)} · ${timeAt(props.stay.checkIn, props.stay.place.timeZone)}`}
			/>
			<Field
				label="Check-out"
				value={`${dayAt(props.stay.checkOut, props.stay.place.timeZone)} · ${timeAt(props.stay.checkOut, props.stay.place.timeZone)}`}
			/>
			<Field label="Address" value={props.stay.place.address} />
			<Field label="Confirmation" value={props.stay.confirmation} />
		</Section>
	)
}

// One fact read at a glance: a small label over its value.
function Essential(props: {label: string; tone?: Tone; value?: string}) {
	if (props.value === undefined) return undefined
	return (
		<VStack alignment="leading" spacing={2} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
			<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>{props.label}</Text>
			<Text
				modifiers={[
					font({design: 'monospaced', textStyle: 'headline'}),
					foregroundStyle(colorOf(props.tone)),
					lineLimit(1)
				]}
			>
				{props.value}
			</Text>
		</VStack>
	)
}

// What a traveller needs at the gate or on the platform, before the rest of the booking.
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
		<HStack spacing={12}>
			<Departs journey={props.flight} />
			<Essential
				label="Gate"
				tone={toneIf(props.flight.live?.previousGate !== undefined, 'warn')}
				value={props.flight.live?.departureGate}
			/>
			<Essential label="Seat" value={props.flight.seat} />
		</HStack>
	)
}

function TrainEssentials(props: {train: Train}) {
	return (
		<HStack spacing={12}>
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
		<HStack spacing={12}>
			<Essential label="Check-in" value={timeAt(props.stay.checkIn, props.stay.place.timeZone)} />
			<Essential label="Check-out" value={timeAt(props.stay.checkOut, props.stay.place.timeZone)} />
		</HStack>
	)
}

// When the provider last answered, so cached data never passes for live.
function updatedOf(booking: Booking, now: number) {
	if (booking._tag === 'stay' || booking.live === undefined) return Option.none<{stale: boolean; text: string}>()
	return Option.some({
		stale: isStale(booking, now),
		text: `Updated ${timeAt(booking.live.checkedAt, booking.from.timeZone)}`
	})
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
	const remove = useAtomSet(removeAtom)
	const refresh = useAtomSet(refreshAtom, {mode: 'promiseExit'})
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	return Option.match(
		Array.findFirst(props.bookings, booking => booking.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="Booking Deleted"
					systemImage="trash"
					modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
				/>
			),
			onSome: booking => {
				const status = statusOf(booking, now)
				return (
					<Toolbar
						modifiers={[
							navigationTitle(titleOf(booking)),
							navigationBarTitleDisplayMode('inline'),
							background(colors.background)
						]}
					>
						<Form
							modifiers={[
								scrollContentBackground('hidden'),
								background(colors.background),
								tint(primary),
								// A failed refresh already alerted, and the exit never rejects, so the pull ends either way.
								refreshable(async () => {
									await refresh(booking.id)
								})
							]}
						>
							<Section>
								<VStack alignment="leading" spacing={12}>
									<VStack alignment="leading" spacing={4}>
										<Text
											modifiers={[font({textStyle: 'title3', weight: 'semibold'}), foregroundStyle(colors.foreground)]}
										>
											{routeOf(booking)}
										</Text>
										<Text modifiers={[text.detail, foregroundStyle(tones[status.tone])]}>{status.label}</Text>
									</VStack>
									{booking._tag === 'flight' && <FlightEssentials flight={booking} />}
									{booking._tag === 'train' && <TrainEssentials train={booking} />}
									{booking._tag === 'stay' && <StayEssentials stay={booking} />}
									{Option.match(updatedOf(booking, now), {
										onNone: () => undefined,
										onSome: updated => (
											<Text
												modifiers={[
													text.caption,
													foregroundStyle(
														Boolean.match(updated.stale, {
															onFalse: () => colors.mutedForeground,
															onTrue: () => tones.warn
														})
													)
												]}
											>
												{updated.text}
											</Text>
										)
									})}
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
											remove(booking)
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
