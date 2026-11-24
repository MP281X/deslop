import {Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import type {ProviderFlightId} from '#services/flights/schema.ts'
import {HORIZON} from '#services/tracking/lib/utils.ts'
import {FaFlights} from '#services/tracking/schema.ts'

export class FlightAware extends Context.Service<FlightAware>()('@deslop/trips/services/tracking/lib/flightaware', {
	make: Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const apiKey = yield* Config.option(Config.Redacted('AEROAPI_KEY'))
		function ask(ident: string, key: Redacted.Redacted, urlParams: Record<string, string>) {
			return pipe(
				HttpClientRequest.get(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}`, {
					headers: {'x-apikey': Redacted.value(key)},
					urlParams: {...urlParams, max_pages: '1'}
				}),
				client.execute,
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(FaFlights))
			)
		}
		return {
			// The operations flying under a designator such as BA553 around the booked departure; none on a server without a key.
			flights: Option.map(apiKey, key =>
				Effect.fn('FlightAware.flights')(function* (designator: string, departs: DateTime.Utc, now: DateTime.Utc) {
					return yield* ask(designator, key, {
						// Tracking starts inside the same horizon, so the end always reaches past the booked departure.
						end: DateTime.formatIso(
							pipe(departs, DateTime.addDuration(Duration.hours(12)), DateTime.min(DateTime.addDuration(now, HORIZON)))
						),
						ident_type: 'designator',
						start: DateTime.formatIso(DateTime.subtractDuration(departs, Duration.hours(12)))
					})
				})
			),
			// One operation by FlightAware's own id, such as the inbound plane a report names.
			operation: Option.map(apiKey, key =>
				Effect.fn('FlightAware.operation')((id: ProviderFlightId) => ask(id, key, {ident_type: 'fa_flight_id'}))
			)
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
