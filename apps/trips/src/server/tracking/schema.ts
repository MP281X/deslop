import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ProviderFlightId} from '#contracts'

// FlightAware AeroAPI v4 GET /flights/{ident}: times are ISO instants, every operational field is null until known.
export type FaFlight = typeof FaFlight.Type
export const FaFlight = Schema.Struct({
	actual_in: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_off: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_on: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	actual_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	aircraft_type: Schema.OptionFromOptionalNullOr(Schema.String),
	cancelled: Schema.Boolean,
	diverted: Schema.Boolean,
	estimated_in: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	estimated_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	fa_flight_id: ProviderFlightId,
	gate_origin: Schema.OptionFromOptionalNullOr(Schema.String),
	// The operation that flies the aircraft in, whose lateness explains this one's.
	inbound_fa_flight_id: Schema.OptionFromOptionalNullOr(ProviderFlightId),
	origin: Schema.OptionFromOptionalNullOr(Schema.Struct({code_iata: Schema.OptionFromOptionalNullOr(Schema.String)})),
	scheduled_in: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	scheduled_out: Schema.OptionFromOptionalNullOr(Schema.DateTimeUtcFromString),
	terminal_origin: Schema.OptionFromOptionalNullOr(Schema.String)
})

export type FaFlights = typeof FaFlights.Type
export const FaFlights = Schema.Struct({flights: Schema.Array(FaFlight)})

// FlightAware lookups made in a month, so the monthly allowance holds across restarts; only the current month is kept.
export class Lookups extends Model.Class<Lookups>('Lookups')({calls: Schema.Int, month: Schema.String}) {
	static readonly table = 'lookups'
}
