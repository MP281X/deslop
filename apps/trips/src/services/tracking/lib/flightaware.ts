import {Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {FaFlights} from '#services/tracking/schema.ts'

export class FlightAware extends Context.Service<FlightAware>()('@deslop/trips/services/tracking/lib/flightaware', {
	make: Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		return {
			// The operations flying under a designator such as BA553 around the booked departure; none on a server without a key.
			flights: Option.map(yield* Config.option(Config.Redacted('AEROAPI_KEY')), apiKey =>
				Effect.fn('FlightAware.flights')(function* (designator: string, departs: DateTime.Utc, now: DateTime.Utc) {
					return yield* pipe(
						HttpClientRequest.get(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(designator)}`, {
							headers: {'x-apikey': Redacted.value(apiKey)},
							urlParams: {
								// FlightAware searches at most two days ahead.
								end: DateTime.formatIso(
									pipe(
										departs,
										DateTime.addDuration(Duration.hours(12)),
										DateTime.min(DateTime.addDuration(now, Duration.hours(47)))
									)
								),
								ident_type: 'designator',
								max_pages: '1',
								start: DateTime.formatIso(DateTime.subtractDuration(departs, Duration.hours(12)))
							}
						}),
						client.execute,
						Effect.flatMap(HttpClientResponse.filterStatusOk),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(FaFlights))
					)
				})
			)
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
