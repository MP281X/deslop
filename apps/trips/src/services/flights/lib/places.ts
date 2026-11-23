import {
	Array,
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	Option,
	Record,
	Result,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import type {Place} from '#services/flights/schema.ts'
import {Airport, FlightsError, PlaceCode} from '#services/flights/schema.ts'

function airportIndex(all: Record<string, unknown>) {
	return Record.fromEntries(
		Array.filterMap(Record.values(all), entry =>
			pipe(
				Schema.decodeUnknownOption(Airport)(entry),
				Option.filter(airport => String.isNonEmpty(airport.iata) && String.isNonEmpty(airport.tz)),
				Option.map(airport => [airport.iata, airport] as const),
				Option.match({onNone: () => Result.failVoid, onSome: Result.succeed})
			)
		)
	)
}

// Airports come from an open dataset with their zone and coordinates.
export class Places extends Context.Service<
	Places,
	{readonly airport: (code: string) => Effect.Effect<Place, FlightsError>}
>()('@deslop/trips/services/flights/lib/places') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient

			// Only a save reads the dataset, and a save already needs the network, so it is fetched again rather than stored: once per start, then monthly.
			const index = yield* Effect.cachedWithTTL(
				pipe(
					client.get('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json'),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Record(Schema.String, Schema.Unknown))),
					Effect.timeout('60 seconds'),
					Effect.retry({
						schedule: Schedule.exponential('2 seconds'),
						times: 2,
						while: error => Cause.isTimeoutError(error) || HttpClient.isTransientError(error)
					}),
					Effect.map(airportIndex)
				),
				exit => Exit.match(exit, {onFailure: () => Duration.zero, onSuccess: () => Duration.days(30)})
			)

			return Places.of({
				airport: Effect.fn('Places.airport')(function* (code) {
					const airports = yield* Effect.mapError(index, cause =>
						FlightsError.make({cause, message: 'The airport list could not be read.'})
					)
					const airport = yield* pipe(
						airports,
						Record.get(PlaceCode.make(String.toUpperCase(String.trim(code)))),
						Effect.fromOption,
						Effect.mapError(() => FlightsError.make({message: `Unknown airport code ${code}.`}))
					)
					return {
						city: Option.some(airport.city),
						code: Option.some(airport.iata),
						latitude: Option.some(airport.lat),
						longitude: Option.some(airport.lon),
						name: airport.name,
						timeZone: airport.tz
					} satisfies Place
				})
			})
		})
	)
}
