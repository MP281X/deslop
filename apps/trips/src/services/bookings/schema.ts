import {Schema, pipe} from 'effect'

export class BookingsError extends Schema.TaggedError<BookingsError>()('BookingsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const IMAGE_BYTES = 4_000_000

export type BookingSource = typeof BookingSource.Type
export const BookingSource = Schema.Union([
	Schema.Struct({text: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(60_000)))}),
	Schema.Struct({image: pipe(Schema.Uint8Array, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES)))})
])

export type BookingId = typeof BookingId.Type
export const BookingId = pipe(Schema.String, Schema.check(Schema.isUUID()))

// An airport, a station or a stay's address; coordinates and the time zone come from a dataset or the provider, never from the ticket.
export type Place = typeof Place.Type
export const Place = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	city: Schema.optionalKey(Schema.String),
	// IATA code for an airport, the provider's station code for a station.
	code: Schema.optionalKey(Schema.String),
	latitude: Schema.optionalKey(Schema.Finite),
	longitude: Schema.optionalKey(Schema.Finite),
	name: Schema.String,
	timeZone: Schema.optionalKey(Schema.String)
})

// Whether the reservation stands; a cancelled one stays listed so the change is visible.
export type ReservationStatus = typeof ReservationStatus.Type
export const ReservationStatus = Schema.Literals(['confirmed', 'cancelled'])

// What the flight provider reports; every field is absent until the provider knows it, and each check replaces the whole record.
export type FlightTracking = typeof FlightTracking.Type
export const FlightTracking = Schema.Struct({
	aircraft: Schema.optional(Schema.String),
	arrivalActual: Schema.optional(Schema.Finite),
	arrivalEstimated: Schema.optional(Schema.Finite),
	arrivalGate: Schema.optional(Schema.String),
	arrivalTerminal: Schema.optional(Schema.String),
	belt: Schema.optional(Schema.String),
	checkedAt: Schema.Finite,
	departureActual: Schema.optional(Schema.Finite),
	departureEstimated: Schema.optional(Schema.Finite),
	departureGate: Schema.optional(Schema.String),
	departureTerminal: Schema.optional(Schema.String),
	landingActual: Schema.optional(Schema.Finite),
	// The gate the flight had before the current one, kept to show the change.
	previousGate: Schema.optional(Schema.String),
	progress: Schema.optional(Schema.Finite),
	// The provider's own id for this operation, such as FlightAware's fa_flight_id.
	providerId: Schema.optional(Schema.String),
	state: Schema.Literals(['scheduled', 'departed', 'airborne', 'landed', 'arrived', 'cancelled', 'diverted']),
	takeoffActual: Schema.optional(Schema.Finite)
})

export type Flight = typeof Flight.Type
export const Flight = Schema.TaggedStruct('flight', {
	airline: Schema.String,
	// The IATA airline designator, such as BA.
	airlineCode: Schema.String,
	arrives: Schema.Finite,
	boardingAt: Schema.optionalKey(Schema.Finite),
	boardingGroup: Schema.optionalKey(Schema.String),
	confirmation: Schema.optionalKey(Schema.String),
	createdAt: Schema.Finite,
	departs: Schema.Finite,
	from: Place,
	id: BookingId,
	live: Schema.optionalKey(FlightTracking),
	number: Schema.String,
	seat: Schema.optionalKey(Schema.String),
	sources: Schema.Array(Schema.String),
	status: ReservationStatus,
	to: Place
})

export type TrainOperator = typeof TrainOperator.Type
export const TrainOperator = Schema.Literals(['trenitalia', 'italo', 'other'])

export type TrainTracking = typeof TrainTracking.Type
export const TrainTracking = Schema.Struct({
	arrivalPlatform: Schema.optional(Schema.String),
	checkedAt: Schema.Finite,
	// The train's delay now, which its arrival carries.
	delayMinutes: Schema.Finite,
	// The delay it left the booked station with.
	departureDelay: Schema.optional(Schema.Finite),
	departurePlatform: Schema.optional(Schema.String),
	// The timetable's platform, kept to show a change.
	departurePlatformPlanned: Schema.optional(Schema.String),
	lastSeen: Schema.optional(Schema.Struct({at: Schema.Finite, station: Schema.String})),
	state: Schema.Literals(['scheduled', 'running', 'departed', 'arrived'])
})

export type Train = typeof Train.Type
export const Train = Schema.TaggedStruct('train', {
	arrives: Schema.Finite,
	coach: Schema.optionalKey(Schema.String),
	confirmation: Schema.optionalKey(Schema.String),
	createdAt: Schema.Finite,
	departs: Schema.Finite,
	from: Place,
	id: BookingId,
	live: Schema.optionalKey(TrainTracking),
	number: Schema.String,
	operator: TrainOperator,
	// The brand on the ticket, such as Frecciarossa or Regionale.
	operatorName: Schema.String,
	seat: Schema.optionalKey(Schema.String),
	sources: Schema.Array(Schema.String),
	status: ReservationStatus,
	to: Place
})

export type Stay = typeof Stay.Type
export const Stay = Schema.TaggedStruct('stay', {
	checkIn: Schema.Finite,
	checkOut: Schema.Finite,
	confirmation: Schema.optionalKey(Schema.String),
	createdAt: Schema.Finite,
	id: BookingId,
	name: Schema.String,
	place: Place,
	sources: Schema.Array(Schema.String),
	status: ReservationStatus
})

export type Booking = typeof Booking.Type
export const Booking = Schema.Union([Flight, Train, Stay])

export type BookingList = typeof BookingList.Type
export const BookingList = Schema.Array(Booking)

export type BookingsEvent = typeof BookingsEvent.Type
export const BookingsEvent = Schema.Struct({
	removed: Schema.Array(BookingId),
	reset: Schema.Boolean,
	upserted: Schema.Array(Booking)
})

// The departures board's colours, which the island and the app each map to their own palette.
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

// The gate, belt or platform: the one value worth reading at a glance.
export type Chip = typeof Chip.Type
export const Chip = Schema.Struct({text: Schema.String, tone: Tone})

// What one Live Activity shows, already worded: the widget runtime renders it without logic of its own, and ActivityKit allows 4 KB per update.
export type ActivityProps = typeof ActivityProps.Type
export const ActivityProps = Schema.Struct({
	arrivalNote: Schema.String,
	// "18:35" in the arrival's own zone, as the airport's boards show it.
	arrivalTime: Schema.String,
	arrivalTone: Tone,
	arrives: Schema.Finite,
	chip: Schema.optionalKey(Chip),
	// The time the timer counts down to; absent once there is nothing to count.
	countdown: Schema.optionalKey(Schema.Finite),
	delay: Schema.Finite,
	departs: Schema.Finite,
	departureNote: Schema.String,
	departureTime: Schema.String,
	departureTone: Tone,
	detail: Schema.String,
	from: Schema.String,
	headline: Schema.String,
	id: BookingId,
	kind: Schema.Literals(['flight', 'train']),
	// What the compact island shows in place of the timer.
	label: Schema.String,
	note: Schema.String,
	phase: Schema.Union([FlightPhase, TrainPhase]),
	// Takeoff, while the flight is in the air.
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

// One reservation as the ticket states it, before the airport, station and time zone are resolved.
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
		flightNumber: Schema.String.annotate({description: 'Digits only, such as 553'}),
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
		trainNumber: Schema.String.annotate({description: 'Digits only, such as 9541'})
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

// One mwgg/Airports entry, keyed by ICAO code.
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

// The airports by IATA code, kept for a month.
export type AirportIndex = typeof AirportIndex.Type
export const AirportIndex = Schema.Struct({airports: Schema.Record(Schema.String, Airport), fetchedAt: Schema.Finite})

// Transitous' stop search, used for a station's coordinates and time zone.
export type StopMatches = typeof StopMatches.Type
export const StopMatches = Schema.Array(
	Schema.Struct({
		// The country, region and city the stop lies in.
		areas: Schema.optionalKey(Schema.Array(Schema.Struct({name: Schema.String}))),
		id: Schema.String,
		lat: Schema.Finite,
		lon: Schema.Finite,
		// Transit modes calling at the stop, such as HIGHSPEED_RAIL or BUS.
		modes: Schema.optionalKey(Schema.Array(Schema.String)),
		name: Schema.String,
		tz: Schema.optionalKey(Schema.String)
	})
)
