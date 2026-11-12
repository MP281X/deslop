import {Schema} from 'effect'

import {Model} from 'effect/schema'

function Nullable<S extends Schema.Top>(schema: S) {
	return Schema.optionalKey(Schema.NullOr(schema))
}

// FlightAware AeroAPI v4 GET /flights/{ident}: times are ISO instants, every operational field is null until known.
export type FaFlight = typeof FaFlight.Type
export const FaFlight = Schema.Struct({
	actual_in: Nullable(Schema.String),
	actual_off: Nullable(Schema.String),
	actual_on: Nullable(Schema.String),
	actual_out: Nullable(Schema.String),
	aircraft_type: Nullable(Schema.String),
	baggage_claim: Nullable(Schema.String),
	cancelled: Schema.Boolean,
	diverted: Schema.Boolean,
	estimated_in: Nullable(Schema.String),
	estimated_out: Nullable(Schema.String),
	fa_flight_id: Schema.String,
	gate_destination: Nullable(Schema.String),
	gate_origin: Nullable(Schema.String),
	origin: Nullable(Schema.Struct({code_iata: Nullable(Schema.String)})),
	scheduled_out: Nullable(Schema.String),
	terminal_destination: Nullable(Schema.String),
	terminal_origin: Nullable(Schema.String)
})

export type FaFlights = typeof FaFlights.Type
export const FaFlights = Schema.Struct({flights: Schema.Array(FaFlight)})

// ViaggiaTreno's run lookup: today's run of a train number, from its origin station.
export type VtRun = typeof VtRun.Type
export const VtRun = Schema.Struct({
	codLocOrig: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/u)),
	millisDataPartenza: Schema.String.check(Schema.isPattern(/^\d+$/u))
})

export type VtStop = typeof VtStop.Type
export const VtStop = Schema.Struct({
	actualFermataType: Nullable(Schema.Finite),
	binarioEffettivoArrivoDescrizione: Nullable(Schema.String),
	binarioEffettivoPartenzaDescrizione: Nullable(Schema.String),
	binarioProgrammatoArrivoDescrizione: Nullable(Schema.String),
	binarioProgrammatoPartenzaDescrizione: Nullable(Schema.String),
	id: Schema.String,
	partenzaReale: Nullable(Schema.Finite),
	programmata: Nullable(Schema.Finite),
	ritardo: Nullable(Schema.Finite),
	stazione: Schema.String
})

export type VtStatus = typeof VtStatus.Type
export const VtStatus = Schema.Struct({
	fermate: Schema.Array(VtStop),
	oraUltimoRilevamento: Nullable(Schema.Finite),
	ritardo: Nullable(Schema.Finite),
	stazioneUltimoRilevamento: Nullable(Schema.String)
})

// FlightAware lookups made in a month, so the monthly allowance holds across restarts; only the current month is kept.
export class Lookups extends Model.Class<Lookups>('Lookups')({calls: Schema.Int, month: Schema.String}) {
	static readonly table = 'lookups'
}
