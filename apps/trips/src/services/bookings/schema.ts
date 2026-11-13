import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

export class BookingsError extends Schema.TaggedError<BookingsError>()('BookingsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const IMAGE_BYTES = 4_000_000

export type BookingSource = typeof BookingSource.Type
export const BookingSource = Schema.Union([
	Schema.TaggedStruct('text', {text: Schema.NonEmptyString.check(Schema.isMaxLength(60_000))}),
	Schema.TaggedStruct('image', {
		image: Schema.Uint8Array.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES))
	})
])

export type BookingId = typeof BookingId.Type
export const BookingId = Schema.String.check(Schema.isUUID())

// Coordinates and the time zone never come from the ticket.
export type Place = typeof Place.Type
export const Place = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	city: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(Schema.String),
	latitude: Schema.optionalKey(Schema.Finite),
	longitude: Schema.optionalKey(Schema.Finite),
	name: Schema.String,
	timeZone: Schema.optionalKey(Schema.String)
})

// A booked journey always knows its place's zone; only a station lookup may answer one without it.
export type BookedPlace = typeof BookedPlace.Type
export const BookedPlace = Schema.Struct({...Place.fields, timeZone: Schema.String})

// Whether the reservation stands; a cancelled one stays listed so the change is visible.
export type ReservationStatus = typeof ReservationStatus.Type
export const ReservationStatus = Schema.Literals(['confirmed', 'cancelled'])

// What the flight provider reports; every field is absent until the provider knows it, and each check replaces the whole record.
export type FlightTracking = typeof FlightTracking.Type
export const FlightTracking = Schema.Struct({
	aircraft: Schema.optionalKey(Schema.String),
	arrivalActual: Schema.optionalKey(Schema.Finite),
	arrivalEstimated: Schema.optionalKey(Schema.Finite),
	arrivalGate: Schema.optionalKey(Schema.String),
	arrivalTerminal: Schema.optionalKey(Schema.String),
	belt: Schema.optionalKey(Schema.String),
	checkedAt: Schema.Finite,
	departureActual: Schema.optionalKey(Schema.Finite),
	departureEstimated: Schema.optionalKey(Schema.Finite),
	departureGate: Schema.optionalKey(Schema.String),
	departureTerminal: Schema.optionalKey(Schema.String),
	previousGate: Schema.optionalKey(Schema.String),
	providerId: Schema.optionalKey(Schema.String),
	state: Schema.Literals(['scheduled', 'departed', 'airborne', 'landed', 'arrived', 'cancelled', 'diverted']),
	takeoffActual: Schema.optionalKey(Schema.Finite)
})

// Each kind of booking is its own table, so a row leaves its kind out and decoding fills it in; the wire keeps it, so the phone tells kinds apart.
function kind<const Tag extends string>(tag: Tag) {
	return Model.Field({
		insert: Schema.tagDefaultOmit(tag),
		json: Schema.tag(tag),
		jsonCreate: Schema.tag(tag),
		jsonUpdate: Schema.tag(tag),
		select: Schema.tagDefaultOmit(tag),
		update: Schema.tagDefaultOmit(tag)
	})
}

// One row of `flights`; places and the provider's latest report are values of the flight, kept as JSON.
export class Flight extends Model.Class<Flight>('Flight')({
	_tag: kind('flight'),
	airline: Schema.String,
	airlineCode: Schema.String,
	arrives: Schema.Int,
	boardingAt: Model.FieldOption(Schema.Int),
	boardingGroup: Model.FieldOption(Schema.String),
	confirmation: Model.FieldOption(Schema.String),
	departs: Schema.Int,
	from: Model.JsonFromString(BookedPlace),
	id: BookingId,
	live: Model.FieldOption(Model.JsonFromString(FlightTracking)),
	number: Schema.String,
	seat: Model.FieldOption(Schema.String),
	status: ReservationStatus,
	to: Model.JsonFromString(BookedPlace)
}) {
	static readonly table = 'flights'
}

export type TrainOperator = typeof TrainOperator.Type
export const TrainOperator = Schema.Literals(['trenitalia', 'italo', 'other'])

export type TrainTracking = typeof TrainTracking.Type
export const TrainTracking = Schema.Struct({
	arrivalPlatform: Schema.optionalKey(Schema.String),
	checkedAt: Schema.Finite,
	delayMinutes: Schema.Finite,
	departureDelay: Schema.optionalKey(Schema.Finite),
	departurePlatform: Schema.optionalKey(Schema.String),
	departurePlatformPlanned: Schema.optionalKey(Schema.String),
	lastSeen: Schema.optionalKey(Schema.Struct({at: Schema.Finite, station: Schema.String})),
	state: Schema.Literals(['scheduled', 'departed', 'arrived'])
})

// One row of `trains`.
export class Train extends Model.Class<Train>('Train')({
	_tag: kind('train'),
	arrives: Schema.Int,
	coach: Model.FieldOption(Schema.String),
	confirmation: Model.FieldOption(Schema.String),
	departs: Schema.Int,
	from: Model.JsonFromString(BookedPlace),
	id: BookingId,
	live: Model.FieldOption(Model.JsonFromString(TrainTracking)),
	number: Schema.String,
	operator: TrainOperator,
	operatorName: Schema.String,
	seat: Model.FieldOption(Schema.String),
	status: ReservationStatus,
	to: Model.JsonFromString(BookedPlace)
}) {
	static readonly table = 'trains'
}

// One row of `stays`.
export class Stay extends Model.Class<Stay>('Stay')({
	_tag: kind('stay'),
	checkIn: Schema.Int,
	checkOut: Schema.Int,
	confirmation: Model.FieldOption(Schema.String),
	id: BookingId,
	name: Schema.String,
	place: Model.JsonFromString(BookedPlace),
	status: ReservationStatus
}) {
	static readonly table = 'stays'
}

// What the server, the phone and the wire know a booking by: absent is `Option.none()` in code, NULL in the row and a missing key on the wire.
export type Booking = typeof Booking.Type
export const Booking = Model.Union([Flight, Train, Stay])

export type BookingList = readonly Booking[]

export type BookingsEvent = typeof BookingsEvent.Type
export const BookingsEvent = Schema.Struct({
	removed: Schema.Array(BookingId),
	reset: Schema.Boolean,
	upserted: Schema.Array(Booking.json)
})

export type Tone = typeof Tone.Type
export const Tone = Schema.Literals(['good', 'warn', 'bad', 'info', 'plain'])

export type FlightPhase = typeof FlightPhase.Type
export const FlightPhase = Schema.Literals([
	'leave',
	'airport',
	'gate',
	'boarding',
	'airborne',
	'landed',
	'cancelled',
	'diverted'
])

export type TrainPhase = typeof TrainPhase.Type
export const TrainPhase = Schema.Literals(['upcoming', 'platform', 'running', 'arrived', 'cancelled'])

export type Chip = typeof Chip.Type
export const Chip = Schema.Struct({text: Schema.String, tone: Tone})

// What one Live Activity shows, already worded: the widget runtime renders it without logic of its own, and ActivityKit allows 4 KB per update.
export type ActivityProps = typeof ActivityProps.Type
export const ActivityProps = Schema.Struct({
	arrivalNote: Schema.String,
	arrivalTime: Schema.String,
	arrivalTone: Tone,
	arrives: Schema.Finite,
	chip: Schema.optionalKey(Chip),
	countdown: Schema.optionalKey(Schema.Finite),
	delay: Schema.Finite,
	departureNote: Schema.String,
	departureTime: Schema.String,
	departureTone: Tone,
	detail: Schema.String,
	from: Schema.String,
	headline: Schema.String,
	kind: Schema.Literals(['flight', 'train']),
	label: Schema.String,
	note: Schema.String,
	phase: Schema.Union([FlightPhase, TrainPhase]),
	progressFrom: Schema.optionalKey(Schema.Finite),
	symbol: Schema.Literals([
		'airplane',
		'airplane.arrival',
		'airplane.departure',
		'car.fill',
		'exclamationmark.triangle.fill',
		'tram.fill'
	]),
	title: Schema.String,
	to: Schema.String,
	tone: Tone
})

// A flight longer than a Live Activity may live gets one activity for departure and another for arrival.
export type Leg = typeof Leg.Type
export const Leg = Schema.Literals(['departure', 'arrival'])

// Times as the ticket prints them: local "2026-10-28T16:40", or with an offset when the source gives one.
export type LocalTime = typeof LocalTime.Type
export const LocalTime = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/u)),
	Schema.annotate({description: 'ISO date and time, local to the place unless the source gives an offset'})
)

export type TripNumber = typeof TripNumber.Type
export const TripNumber = Schema.String.check(Schema.isPattern(/^\d+$/u))

export type ExtractedItem = typeof ExtractedItem.Type
export const ExtractedItem = Schema.Union([
	Schema.Struct({
		airlineCode: Schema.String.annotate({description: 'IATA airline designator, such as BA or FR'}),
		airlineName: Schema.String,
		arrival: LocalTime,
		boarding: Schema.optionalKey(LocalTime),
		boardingGroup: Schema.optionalKey(Schema.String),
		confirmation: Schema.optionalKey(Schema.String),
		departure: LocalTime,
		flightNumber: TripNumber.annotate({description: 'Digits only, such as 553'}),
		from: Schema.String.annotate({description: 'IATA airport code'}),
		kind: Schema.Literal('flight'),
		seat: Schema.optionalKey(Schema.String),
		status: ReservationStatus,
		to: Schema.String.annotate({description: 'IATA airport code'})
	}),
	Schema.Struct({
		arrival: LocalTime,
		coach: Schema.optionalKey(Schema.String),
		confirmation: Schema.optionalKey(Schema.String),
		departure: LocalTime,
		from: Schema.String.annotate({description: 'Station name as printed, such as Roma Termini'}),
		kind: Schema.Literal('train'),
		operator: TrainOperator,
		operatorName: Schema.String,
		seat: Schema.optionalKey(Schema.String),
		status: ReservationStatus,
		to: Schema.String,
		trainNumber: TripNumber.annotate({description: 'Digits only, such as 9541'})
	}),
	Schema.Struct({
		address: Schema.String.annotate({description: 'Full street address with city and country'}),
		checkIn: LocalTime,
		checkOut: LocalTime,
		city: Schema.String,
		confirmation: Schema.optionalKey(Schema.String),
		kind: Schema.Literal('stay'),
		name: Schema.String,
		status: ReservationStatus,
		timeZone: Schema.String.annotate({description: 'IANA time zone of the city, such as Europe/London'})
	})
])

export type ExtractedItems = typeof ExtractedItems.Type
export const ExtractedItems = Schema.Array(ExtractedItem)

export type Extraction = typeof Extraction.Type
export const Extraction = Schema.Struct({items: ExtractedItems})

export type Airport = typeof Airport.Type
export const Airport = Schema.Struct({
	city: Schema.String,
	iata: Schema.String,
	icao: Schema.String,
	lat: Schema.Finite,
	lon: Schema.Finite,
	name: Schema.String,
	tz: Schema.String
})

export type StopMatches = typeof StopMatches.Type
export const StopMatches = Schema.Array(
	Schema.Struct({
		areas: Schema.optionalKey(Schema.Array(Schema.Struct({name: Schema.String}))),
		id: Schema.String,
		lat: Schema.Finite,
		lon: Schema.Finite,
		modes: Schema.optionalKey(Schema.Array(Schema.String)),
		name: Schema.String,
		tz: Schema.optionalKey(Schema.String)
	})
)
