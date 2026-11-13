import {
	Array,
	Cache,
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

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import type {BookedPlace, Place} from '#services/bookings/schema.ts'
import {Airport, BookingsError, StopMatches} from '#services/bookings/schema.ts'

const RAIL = ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN']
const GENERIC = ['bahnhof', 'central', 'centraal', 'centrale', 'gare', 'hauptbahnhof', 'hbf', 'station', 'stazione']

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

function words(text: string) {
	return pipe(
		text,
		String.normalize('NFD'),
		String.replaceAll(/[̀-ͯ]/gu, ''),
		String.toLowerCase,
		String.split(/[^a-z0-9]+/u)
	)
}

function stationMatch(name: string, matches: StopMatches) {
	const named = Array.filter(matches, match => {
		const own = words(
			`${match.name} ${pipe(
				match.areas ?? [],
				Array.map(area => area.name),
				Array.join(' ')
			)}`
		)
		return pipe(
			words(name),
			Array.findFirst(word => String.length(word) >= 3 && !Array.contains(GENERIC, word)),
			Option.exists(word => Array.contains(own, word))
		)
	})
	return pipe(
		named,
		Array.findFirst(match => Array.some(match.modes ?? [], mode => Array.contains(RAIL, mode))),
		Option.orElse(() => Array.head(named)),
		Option.map(
			match =>
				({
					code: match.id,
					latitude: match.lat,
					longitude: match.lon,
					name: pipe(
						String.toLowerCase(match.name),
						String.split(' '),
						Array.map(word => String.capitalize(word)),
						Array.join(' ')
					),
					...Option.match(Option.fromUndefinedOr(match.tz), {onNone: () => ({}), onSome: timeZone => ({timeZone})})
				}) satisfies Place
		)
	)
}

// Airports come from an open dataset with their zone and coordinates; stations from Transitous, which also names the Trenitalia station code.
export class Places extends Context.Service<
	Places,
	{
		readonly airport: (code: string) => Effect.Effect<BookedPlace, BookingsError>
		readonly station: (name: string) => Effect.Effect<Place, BookingsError>
	}
>()('@deslop/trips/services/bookings/lib/places') {
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
					Effect.retry({schedule: Schedule.exponential('2 seconds'), times: 2}),
					Effect.map(airportIndex)
				),
				exit => Exit.match(exit, {onFailure: () => Duration.zero, onSuccess: () => Duration.days(30)})
			)

			const stations = yield* Cache.makeWith(
				Effect.fnUntraced(function* (name: string) {
					const matches = yield* pipe(
						// Transitous refuses a client that does not name itself.
						HttpClientRequest.get('https://api.transitous.org/api/v1/geocode', {
							headers: {'user-agent': 'Trips (+https://trips.mp281x.xyz)'},
							urlParams: {text: name, type: 'STOP'}
						}),
						client.execute,
						Effect.flatMap(HttpClientResponse.filterStatusOk),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(StopMatches)),
						Effect.timeout('15 seconds')
					)
					return stationMatch(name, matches)
				}),
				{
					capacity: 1000,
					timeToLive: exit =>
						Exit.match(exit, {
							onFailure: () => Duration.zero,
							onSuccess: place => Option.match(place, {onNone: () => Duration.zero, onSome: () => Duration.infinity})
						})
				}
			)

			return Places.of({
				airport: Effect.fn('Places.airport')(function* (code) {
					const airports = yield* Effect.mapError(index, cause =>
						BookingsError.make({cause, message: 'The airport list could not be read.'})
					)
					const airport = yield* pipe(
						airports,
						Record.get(String.toUpperCase(String.trim(code))),
						Effect.fromOption,
						Effect.mapError(() => BookingsError.make({message: `Unknown airport code ${code}.`}))
					)
					return {
						city: airport.city,
						code: airport.iata,
						latitude: airport.lat,
						longitude: airport.lon,
						name: airport.name,
						timeZone: airport.tz
					} satisfies BookedPlace
				}),
				station: Effect.fn('Places.station')(function* (name) {
					const key: string = String.toLowerCase(String.trim(name))
					return Option.getOrElse(
						yield* pipe(
							stations,
							Cache.get(key),
							Effect.mapError(cause =>
								BookingsError.make({cause, message: `The station ${name} could not be looked up.`})
							)
						),
						() => ({name})
					)
				})
			})
		})
	)
}
