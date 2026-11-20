import {Duration, Schema, SchemaGetter, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

export type DurationFromMinutes = typeof DurationFromMinutes.Type
export const DurationFromMinutes = pipe(
	Schema.Finite,
	Schema.decodeTo(Schema.Duration, {
		decode: SchemaGetter.transform(Duration.minutes),
		encode: SchemaGetter.transform(Duration.toMinutes)
	})
)

export type PlaceCode = typeof PlaceCode.Type
export const PlaceCode = pipe(Schema.String, Schema.brand('PlaceCode'))
export type ProviderFlightId = typeof ProviderFlightId.Type
export const ProviderFlightId = pipe(Schema.String, Schema.brand('ProviderFlightId'))

export class BookingsError extends Schema.TaggedError<BookingsError>()('BookingsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const IMAGE_BYTES = 4_000_000

export type BookingSource = typeof BookingSource.Type
export const BookingSource = Schema.TaggedUnion({
	image: {image: Schema.Uint8Array.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES))},
	pdf: {pdf: Schema.Uint8Array.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES))},
	text: {text: Schema.NonEmptyString.check(Schema.isMaxLength(60_000))}
})

export type BookingId = typeof BookingId.Type
export const BookingId = pipe(Schema.String, Schema.check(Schema.isUUID()), Schema.brand('BookingId'))

export type BookingIds = typeof BookingIds.Type
// The legs of one journey as the phone showed them; a delete removes these and no others.
export const BookingIds = Schema.NonEmptyArray(BookingId).check(Schema.isMaxLength(50))

// Coordinates and the time zone never come from the ticket.
export type Place = typeof Place.Type
export const Place = Schema.Struct({
	address: Schema.OptionFromOptionalKey(Schema.String),
	city: Schema.OptionFromOptionalKey(Schema.String),
	code: Schema.OptionFromOptionalKey(PlaceCode),
	latitude: Schema.OptionFromOptionalKey(Schema.Finite),
	longitude: Schema.OptionFromOptionalKey(Schema.Finite),
	name: Schema.String,
	timeZone: Schema.OptionFromOptionalKey(Schema.String)
})

// A booked journey always knows its place's zone; only a station lookup may answer one without it.
export type BookedPlace = typeof BookedPlace.Type
export const BookedPlace = Schema.Struct({...Place.fields, timeZone: Schema.String})

export type ReservationStatus = typeof ReservationStatus.Type
// Whether the reservation stands; a cancelled one stays listed so the change is visible.
export const ReservationStatus = Schema.Literals(['confirmed', 'cancelled'])

// What the flight provider reports; every field is absent until the provider knows it, and each check replaces the whole record.
export type FlightTracking = typeof FlightTracking.Type
export const FlightTracking = Schema.Struct({
	aircraft: Schema.OptionFromOptionalKey(Schema.String),
	arrivalActual: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	arrivalEstimated: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	arrivalGate: Schema.OptionFromOptionalKey(Schema.String),
	arrivalTerminal: Schema.OptionFromOptionalKey(Schema.String),
	belt: Schema.OptionFromOptionalKey(Schema.String),
	checkedAt: DateTimeUtcFromFiniteMillis,
	departureActual: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	departureEstimated: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	departureGate: Schema.OptionFromOptionalKey(Schema.String),
	departureTerminal: Schema.OptionFromOptionalKey(Schema.String),
	previousGate: Schema.OptionFromOptionalKey(Schema.String),
	providerId: Schema.OptionFromOptionalKey(ProviderFlightId),
	state: Schema.Literals(['scheduled', 'departed', 'airborne', 'landed', 'arrived', 'cancelled', 'diverted']),
	takeoffActual: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis)
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
	arrives: Schema.DateTimeUtcFromMillis,
	boardingAt: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	// fallow-ignore-next-line code-duplication -- A flight and a train each spell out their own columns; the fields they share are shape, not logic.
	boardingGroup: Model.FieldOption(Schema.String),
	confirmation: Model.FieldOption(Schema.String),
	departs: Schema.DateTimeUtcFromMillis,
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

export type TrainStop = typeof TrainStop.Type
export const TrainStop = Schema.Struct({
	arrives: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	code: Schema.OptionFromOptionalKey(PlaceCode),
	departs: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	name: Schema.String,
	// The stop's own zone, since a train can cross one; stops saved before it was kept read in the departure's.
	timeZone: Schema.OptionFromOptionalKey(Schema.String)
})

export type TrainTracking = typeof TrainTracking.Type
export const TrainTracking = Schema.Struct({
	arrivalPlatform: Schema.OptionFromOptionalKey(Schema.String),
	checkedAt: DateTimeUtcFromFiniteMillis,
	delayMinutes: DurationFromMinutes,
	departureDelay: Schema.OptionFromOptionalKey(DurationFromMinutes),
	departurePlatform: Schema.OptionFromOptionalKey(Schema.String),
	departurePlatformPlanned: Schema.OptionFromOptionalKey(Schema.String),
	lastSeen: Schema.OptionFromOptionalKey(Schema.Struct({at: DateTimeUtcFromFiniteMillis, station: Schema.String})),
	state: Schema.Literals(['scheduled', 'departed', 'arrived', 'cancelled'])
})

// One row of `trains`.
export class Train extends Model.Class<Train>('Train')({
	_tag: kind('train'),
	arrives: Schema.DateTimeUtcFromMillis,
	coach: Model.FieldOption(Schema.String),
	confirmation: Model.FieldOption(Schema.String),
	departs: Schema.DateTimeUtcFromMillis,
	from: Model.JsonFromString(BookedPlace),
	id: BookingId,
	live: Model.FieldOption(Model.JsonFromString(TrainTracking)),
	number: Schema.String,
	operator: Schema.String,
	seat: Model.FieldOption(Schema.String),
	service: Schema.String,
	status: ReservationStatus,
	stops: Model.JsonFromString(Schema.Array(TrainStop)),
	to: Model.JsonFromString(BookedPlace)
}) {
	static readonly table = 'trains'
}

// One row of `stays`.
export class Stay extends Model.Class<Stay>('Stay')({
	_tag: kind('stay'),
	checkIn: Schema.DateTimeUtcFromMillis,
	checkOut: Schema.DateTimeUtcFromMillis,
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
export const BookingModel = Model.Union([Flight, Train, Stay])
export const Booking = Schema.toTaggedUnion('_tag')(BookingModel)

export type BookingList = readonly Booking[]

export type BookingsEvent = typeof BookingsEvent.Type
export const BookingsEvent = Schema.Struct({
	removed: Schema.Array(BookingId),
	reset: Schema.Boolean,
	upserted: Schema.Array(BookingModel.json)
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
	arrives: DateTimeUtcFromFiniteMillis,
	chip: Schema.OptionFromOptionalKey(Chip),
	countdown: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	delay: DurationFromMinutes,
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
	progressFrom: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	stops: Schema.OptionFromOptionalKey(Schema.Array(Schema.Struct({name: Schema.String, passed: Schema.Boolean}))),
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

export type Short = typeof Short.Type
// What a ticket prints in a few words, bounded so a misread field cannot outgrow the Live Activity's 4 KB update.
export const Short = Schema.String.check(Schema.isMaxLength(40))
export type Name = typeof Name.Type
export const Name = Schema.String.check(Schema.isMaxLength(120))

export type ExtractedItem = typeof ExtractedItem.Type
export const ExtractedItem = Schema.Union([
	Schema.Struct({
		airlineCode: Short.annotate({description: 'IATA airline designator, such as BA or FR'}),
		airlineName: Name,
		arrival: LocalTime,
		boarding: Schema.OptionFromOptionalKey(LocalTime),
		boardingGroup: Schema.OptionFromOptionalKey(Short),
		confirmation: Schema.OptionFromOptionalKey(Short),
		departure: LocalTime,
		flightNumber: TripNumber.annotate({description: 'Digits only, such as 553'}),
		from: Short.annotate({description: 'IATA airport code'}),
		kind: Schema.Literal('flight'),
		seat: Schema.OptionFromOptionalKey(Short),
		status: ReservationStatus,
		to: Short.annotate({description: 'IATA airport code'})
	}),
	Schema.Struct({
		coach: Schema.OptionFromOptionalKey(Short),
		confirmation: Schema.OptionFromOptionalKey(Short),
		departure: LocalTime,
		from: Name.annotate({description: 'Station name as printed, such as Roma Termini'}),
		kind: Schema.Literal('train'),
		seat: Schema.OptionFromOptionalKey(Short),
		status: ReservationStatus,
		to: Name,
		trainNumber: TripNumber.annotate({description: 'Digits only, such as 9541'})
	}),
	Schema.Struct({
		address: Schema.String.check(Schema.isMaxLength(300)).annotate({
			description: 'Full street address with city and country'
		}),
		checkIn: LocalTime,
		checkOut: LocalTime,
		city: Name,
		confirmation: Schema.OptionFromOptionalKey(Short),
		kind: Schema.Literal('stay'),
		name: Name,
		status: ReservationStatus,
		timeZone: Short.annotate({description: 'IANA time zone of the city, such as Europe/London'})
	})
])

export type ExtractedItems = typeof ExtractedItems.Type
export const ExtractedItems = Schema.Array(ExtractedItem)

export type BookingExtraction = typeof BookingExtraction.Type
export const BookingExtraction = Schema.Struct({items: ExtractedItems})

export type Airport = typeof Airport.Type
export const Airport = Schema.Struct({
	city: Schema.String,
	iata: PlaceCode,
	icao: Schema.String,
	lat: Schema.Finite,
	lon: Schema.Finite,
	name: Schema.String,
	tz: Schema.String
})

export type StopMatches = typeof StopMatches.Type
export const StopMatches = Schema.Array(
	Schema.Struct({
		areas: Schema.OptionFromOptionalKey(Schema.Array(Schema.Struct({name: Schema.String}))),
		id: PlaceCode,
		lat: Schema.Finite,
		lon: Schema.Finite,
		modes: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
		name: Schema.String,
		tz: Schema.OptionFromOptionalKey(Schema.String)
	})
)

export type TransitStop = typeof TransitStop.Type
export const TransitStop = Schema.Struct({
	arrival: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
	departure: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
	lat: Schema.Finite,
	lon: Schema.Finite,
	name: Schema.String,
	stopId: PlaceCode,
	tz: Schema.String
})
export type TransitRuns = typeof TransitRuns.Type
export const TransitRuns = Schema.Struct({
	stopTimes: Schema.Array(
		Schema.Struct({
			agencyName: Schema.String,
			place: Schema.Struct({departure: Schema.DateTimeUtcFromString, tz: Schema.String}),
			routeShortName: Schema.String,
			tripId: Schema.String,
			tripShortName: Schema.String
		})
	)
})
export type TransitTrip = typeof TransitTrip.Type
export const TransitTrip = Schema.Struct({
	legs: Schema.NonEmptyArray(
		Schema.Struct({from: TransitStop, intermediateStops: Schema.Array(TransitStop), to: TransitStop})
	)
})
