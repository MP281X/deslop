import {Schema, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {DurationFromMinutes, Place, ProviderFlightId} from '#services/bookings/schema.ts'

export type StopPlace = typeof StopPlace.Type
export const StopPlace = Schema.Struct(Struct.pick(Place.fields, ['code', 'name']))

export type StationId = typeof StationId.Type
export const StationId = pipe(Schema.String, Schema.brand('StationId'))

// FlightAware AeroAPI v4 GET /flights/{ident}: times are ISO instants, every operational field is null until known.
export type FaFlight = typeof FaFlight.Type
export const FaFlight = Schema.Struct({
	actual_in: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_off: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_on: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	aircraft_type: Schema.OptionFromOptionalNullOr(Schema.String),
	baggage_claim: Schema.OptionFromOptionalNullOr(Schema.String),
	cancelled: Schema.Boolean,
	diverted: Schema.Boolean,
	estimated_in: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	estimated_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	fa_flight_id: ProviderFlightId,
	gate_destination: Schema.OptionFromOptionalNullOr(Schema.String),
	gate_origin: Schema.OptionFromOptionalNullOr(Schema.String),
	origin: Schema.OptionFromOptionalNullOr(Schema.Struct({code_iata: Schema.OptionFromOptionalNullOr(Schema.String)})),
	scheduled_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	terminal_destination: Schema.OptionFromOptionalNullOr(Schema.String),
	terminal_origin: Schema.OptionFromOptionalNullOr(Schema.String)
})

export type FaFlights = typeof FaFlights.Type
export const FaFlights = Schema.Struct({flights: Schema.Array(FaFlight)})

// ViaggiaTreno's run lookup: today's run of a train number, from its origin station.
export type VtRun = typeof VtRun.Type
export const VtRun = Schema.Struct({
	codLocOrig: StationId.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/u)),
	millisDataPartenza: pipe(
		Schema.String.check(Schema.isPattern(/^\d+$/u)),
		Schema.decodeTo(Schema.FiniteFromString),
		Schema.decodeTo(DateTimeUtcFromFiniteMillis)
	)
})

export type VtStop = typeof VtStop.Type
export const VtStop = Schema.Struct({
	actualFermataType: Schema.OptionFromOptionalNullOr(Schema.Finite),
	binarioEffettivoArrivoDescrizione: Schema.OptionFromOptionalNullOr(Schema.String),
	binarioEffettivoPartenzaDescrizione: Schema.OptionFromOptionalNullOr(Schema.String),
	binarioProgrammatoArrivoDescrizione: Schema.OptionFromOptionalNullOr(Schema.String),
	binarioProgrammatoPartenzaDescrizione: Schema.OptionFromOptionalNullOr(Schema.String),
	id: StationId,
	partenzaReale: Schema.OptionFromOptionalNullOr(DateTimeUtcFromFiniteMillis),
	programmata: Schema.OptionFromOptionalNullOr(DateTimeUtcFromFiniteMillis),
	ritardo: Schema.OptionFromOptionalNullOr(DurationFromMinutes),
	stazione: Schema.String
})

export type VtStatus = typeof VtStatus.Type
export const VtStatus = Schema.Struct({
	fermate: Schema.Array(VtStop),
	oraUltimoRilevamento: Schema.OptionFromOptionalNullOr(DateTimeUtcFromFiniteMillis),
	ritardo: Schema.OptionFromOptionalNullOr(DurationFromMinutes),
	stazioneUltimoRilevamento: Schema.OptionFromOptionalNullOr(Schema.String)
})

// FlightAware lookups made in a month, so the monthly allowance holds across restarts; only the current month is kept.
export class Lookups extends Model.Class<Lookups>('Lookups')({calls: Schema.Int, month: Schema.String}) {
	static readonly table = 'lookups'
}
