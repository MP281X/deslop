import {Duration, Schema, SchemaGetter, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {Device as ApnsDevice} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'
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
	// How late the plane flying in lands, read only while this flight is late, so a delay can name its cause.
	inboundDelay: Schema.OptionFromOptionalKey(DurationFromMinutes),
	previousGate: Schema.OptionFromOptionalKey(Schema.String),
	providerId: Schema.OptionFromOptionalKey(ProviderFlightId),
	state: Schema.Literals(['scheduled', 'departed', 'airborne', 'landed', 'arrived', 'cancelled', 'diverted']),
	takeoffActual: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis)
})

// One person on a flight under their own reservation, with its code, whether it stands and whether a boarding pass for them was read; a ticket that names nobody, or a flight saved before Trips read names, holds its reservation under no name. The e-ticket number, when a ticket prints it, tells two people of one name apart.
export type Traveller = typeof Traveller.Type
export const Traveller = Schema.Struct({
	boardingGroup: Schema.OptionFromOptionalKey(Schema.String),
	boardingPass: Schema.Boolean,
	confirmation: Schema.OptionFromOptionalKey(Schema.String),
	name: Schema.OptionFromOptionalKey(Schema.String),
	seat: Schema.OptionFromOptionalKey(Schema.String),
	status: ReservationStatus,
	ticket: Schema.OptionFromOptionalKey(Schema.String)
})

// One row of `flights`: one service, a flight number on a day, with everyone on it; places, travellers and the provider's latest report are values of the flight, kept as JSON. Absent is `Option.none()` in code, NULL in the row and a missing key on the wire.
export class Flight extends Model.Class<Flight>('Flight')({
	airline: Schema.String,
	airlineCode: Schema.String,
	arrives: Schema.DateTimeUtcFromMillis,
	boardingAt: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	departs: Schema.DateTimeUtcFromMillis,
	from: Model.JsonFromString(Place),
	id: FlightId,
	live: Model.FieldOption(Model.JsonFromString(FlightTracking)),
	number: Schema.String,
	to: Model.JsonFromString(Place),
	travellers: Model.JsonFromString(Schema.Array(Traveller))
}) {
	static readonly table = 'flights'
}

export type FlightList = readonly Flight[]

export type TravelMinutes = typeof TravelMinutes.Type
export const TravelMinutes = Schema.Int.check(Schema.isBetween({maximum: 720, minimum: 5}))

// One row of `travel_times`: how long the trip from home to an airport takes, saved once for each airport.
export class TravelTime extends Model.Class<TravelTime>('TravelTime')({airport: PlaceCode, minutes: TravelMinutes}) {
	static readonly table = 'travel_times'
}

export type FlightsEvent = typeof FlightsEvent.Type
export const FlightsEvent = Schema.Struct({
	removed: Schema.Array(FlightId),
	reset: Schema.Boolean,
	upserted: Schema.Array(Flight.json)
})

export type Tone = typeof Tone.Type
export const Tone = Schema.Literals(['good', 'warn', 'bad', 'info', 'plain'])

// Where the day stands: on the way to the airport, then at the gate, boarding, away from the gate before takeoff, in the air, and landed at its end.
export type FlightPhase = typeof FlightPhase.Type
export const FlightPhase = Schema.Literals([
	'leave',
	'airport',
	'gate',
	'boarding',
	'taxiing',
	'airborne',
	'landed',
	'cancelled',
	'diverted'
])

// The day's bar: the way to the airport, the gate, boarding and the flight.
export type Segment = typeof Segment.Type
export const Segment = Schema.Literals([0, 1, 2, 3])

// What the day's one Live Activity shows, already worded: the widget runtime renders it without logic of its own, and ActivityKit allows 4 KB per update. Two fields never move, what to do on the left and the time left on the right, over the bar and one line of small print.
export type ActivityProps = typeof ActivityProps.Type
export const ActivityProps = Schema.Struct({
	// The deadline the ring and the time left count down to, from `since`; none once nothing is left to wait for.
	deadline: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	delay: DurationFromMinutes,
	// The island's leading slot: the gate, or a symbol while there is none.
	gate: Schema.OptionFromOptionalKey(Schema.String),
	// The compact and expanded island share these words on the ground.
	island: Schema.optionalKey(
		Schema.Struct({
			detail: Schema.optionalKey(Schema.String),
			footer: Schema.String,
			title: Schema.String,
			value: Schema.String,
			warning: Schema.Boolean
		})
	),
	label: Schema.String,
	note: Schema.String,
	noteTone: Tone,
	noteWas: Schema.OptionFromOptionalKey(Schema.String),
	// A placeholder value, such as a gate not yet posted, drawn faint.
	pending: Schema.Boolean,
	phase: FlightPhase,
	problem: Schema.OptionFromOptionalKey(Schema.String),
	segment: Segment,
	// The bar's current part fills from `segmentSince` to `segmentUntil`.
	segmentSince: DateTimeUtcFromFiniteMillis,
	segmentUntil: DateTimeUtcFromFiniteMillis,
	since: DateTimeUtcFromFiniteMillis,
	small: Schema.String,
	symbol: Schema.Literals([
		'airplane',
		'airplane.arrival',
		'airplane.departure',
		'car.fill',
		'exclamationmark.triangle.fill'
	]),
	// The ring turns the warning colour while the small print names a problem.
	tone: Tone,
	until: Schema.String,
	// What `until` shows in place of a countdown once there is no deadline.
	untilValue: Schema.String,
	value: Schema.String,
	was: Schema.OptionFromOptionalKey(Schema.String)
})

export class PushError extends Schema.TaggedError<PushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type PushBundle = typeof PushBundle.Type
// The release app, on Apple's production push service, and the Simulator build, on its sandbox; the server pushes to no other app.
export const PushBundle = Schema.Literals(['xyz.mp281x.trips', 'xyz.mp281x.trips.dev'])

export type PhoneId = typeof PhoneId.Type
// The iPhone a token belongs to, as iOS names it for this developer's apps: a Live Activity tells its changes only to the phone it runs on.
export const PhoneId = pipe(Schema.NonEmptyString, Schema.brand('PhoneId'))

// One row of `devices`: an alert or push-to-start token of one iPhone's app.
export class Device extends Model.Class<Device>('Device')({...Model.fields(ApnsDevice), phone: PhoneId}) {
	static readonly table = 'devices'
}

export const FlightRpcs = RpcGroup.make(
	Rpc.make('flights.events', {error: FlightsError, stream: true, success: FlightsEvent}),
	Rpc.make('flights.save', {error: FlightsError, payload: TicketSource}),
	Rpc.make('flights.remove', {error: FlightsError, payload: Schema.Struct({id: FlightId})}),
	// The trip from home to each airport, saved once per airport.
	Rpc.make('travel.list', {error: FlightsError, success: Schema.Array(TravelTime)}),
	Rpc.make('travel.set', {error: FlightsError, payload: TravelTime})
).middleware(RpcAuth)

// Asks the provider now while the flight is tracked, at most twice as often as its schedule.
export const TrackingRpcs = RpcGroup.make(
	Rpc.make('tracking.refresh', {error: FlightsError, payload: Schema.Struct({id: FlightId})})
).middleware(RpcAuth)

export const PushRpcs = RpcGroup.make(
	Rpc.make('push.register', {
		error: PushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: PushBundle}))
	})
).middleware(RpcAuth)

export const TripsRpcs = FlightRpcs.merge(TrackingRpcs, PushRpcs)
