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

export class FlightsError extends Schema.TaggedError<FlightsError>()('FlightsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const IMAGE_BYTES = 4_000_000

export type TicketSource = typeof TicketSource.Type
export const TicketSource = Schema.TaggedUnion({
	image: {image: Schema.Uint8Array.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES))},
	pdf: {pdf: Schema.Uint8Array.check(Schema.isMinLength(1), Schema.isMaxLength(IMAGE_BYTES))},
	text: {text: Schema.NonEmptyString.check(Schema.isMaxLength(60_000))}
})

export type FlightId = typeof FlightId.Type
export const FlightId = pipe(Schema.String, Schema.check(Schema.isUUID()), Schema.brand('FlightId'))

// Coordinates and the time zone never come from the ticket.
export type Place = typeof Place.Type
export const Place = Schema.Struct({
	city: Schema.OptionFromOptionalKey(Schema.String),
	code: Schema.OptionFromOptionalKey(PlaceCode),
	latitude: Schema.OptionFromOptionalKey(Schema.Finite),
	longitude: Schema.OptionFromOptionalKey(Schema.Finite),
	name: Schema.String,
	timeZone: Schema.String
})

export type ReservationStatus = typeof ReservationStatus.Type
// Whether the reservation stands; a cancelled one stays listed so the change is visible.
export const ReservationStatus = Schema.Literals(['confirmed', 'cancelled'])

// What the flight provider reports; every field is absent until the provider knows it, and each check replaces the whole record.
export type FlightTracking = typeof FlightTracking.Type
export const FlightTracking = Schema.Struct({
	aircraft: Schema.OptionFromOptionalKey(Schema.String),
	arrivalActual: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	arrivalEstimated: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
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

// One person on a flight with their seat and boarding group; a flight saved before Trips read names holds its seat under no name.
export type Traveller = typeof Traveller.Type
export const Traveller = Schema.Struct({
	boardingGroup: Schema.OptionFromOptionalKey(Schema.String),
	name: Schema.OptionFromOptionalKey(Schema.String),
	seat: Schema.OptionFromOptionalKey(Schema.String)
})

// One row of `flights`; places, travellers and the provider's latest report are values of the flight, kept as JSON. Absent is `Option.none()` in code, NULL in the row and a missing key on the wire.
export class Flight extends Model.Class<Flight>('Flight')({
	airline: Schema.String,
	airlineCode: Schema.String,
	arrives: Schema.DateTimeUtcFromMillis,
	boardingAt: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	confirmation: Model.FieldOption(Schema.String),
	departs: Schema.DateTimeUtcFromMillis,
	from: Model.JsonFromString(Place),
	id: FlightId,
	live: Model.FieldOption(Model.JsonFromString(FlightTracking)),
	number: Schema.String,
	status: ReservationStatus,
	to: Model.JsonFromString(Place),
	travellers: Model.JsonFromString(Schema.Array(Traveller))
}) {
	static readonly table = 'flights'
}

export type FlightList = readonly Flight[]

export type FlightsEvent = typeof FlightsEvent.Type
export const FlightsEvent = Schema.Struct({
	removed: Schema.Array(FlightId),
	reset: Schema.Boolean,
	upserted: Schema.Array(Flight.json)
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
	label: Schema.String,
	note: Schema.String,
	phase: FlightPhase,
	progressFrom: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	symbol: Schema.Literals([
		'airplane',
		'airplane.arrival',
		'airplane.departure',
		'car.fill',
		'exclamationmark.triangle.fill'
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

export type ExtractedFlight = typeof ExtractedFlight.Type
export const ExtractedFlight = Schema.Struct({
	airlineCode: Short.annotate({description: 'IATA airline designator, such as BA or FR'}),
	airlineName: Name,
	arrival: LocalTime,
	boarding: Schema.OptionFromOptionalKey(LocalTime),
	confirmation: Schema.OptionFromOptionalKey(Short),
	departure: LocalTime,
	flightNumber: TripNumber.annotate({description: 'Digits only, such as 553'}),
	from: Short.annotate({description: 'IATA airport code'}),
	status: ReservationStatus,
	to: Short.annotate({description: 'IATA airport code'}),
	travellers: Schema.Array(
		Schema.Struct({
			boardingGroup: Schema.OptionFromOptionalKey(Short),
			name: Name.annotate({description: 'Given names then family name, without titles, such as Matteo Rossi'}),
			seat: Schema.OptionFromOptionalKey(Short)
		})
	).annotate({description: 'Every passenger the text names for this flight'})
})

export type ExtractedFlights = typeof ExtractedFlights.Type
export const ExtractedFlights = Schema.Array(ExtractedFlight)

export type FlightExtraction = typeof FlightExtraction.Type
export const FlightExtraction = Schema.Struct({flights: ExtractedFlights})

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
