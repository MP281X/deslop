import {
	Array,
	Cache,
	Clock,
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	Number,
	Option,
	Record,
	Result,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {DAY} from '#services/bookings/lib/utils.ts'
import type {Place} from '#services/bookings/schema.ts'
import {Airport, AirportIndex, BookingsError, StopMatches} from '#services/bookings/schema.ts'

const RAIL = ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN']
const GENERIC = ['bahnhof', 'central', 'centraal', 'centrale', 'gare', 'hauptbahnhof', 'hbf', 'station', 'stazione']

function airportIndex(all: Record<string, unknown>, fetchedAt: number) {
	return {
		airports: Record.fromEntries(
			Array.filterMap(Record.values(all), entry =>
				pipe(
					Schema.decodeUnknownOption(Airport)(entry),
					Option.filter(airport => String.isNonEmpty(airport.iata) && String.isNonEmpty(airport.tz)),
					Option.map(airport => [airport.iata, airport] as const),
					Option.match({onNone: () => Result.failVoid, onSome: Result.succeed})
				)
			)
		),
		fetchedAt
	}
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
			`${match.name} ${Array.join(
				Array.map(match.areas ?? [], area => area.name),
				' '
			)}`
		)
		return Option.exists(
			Array.findFirst(words(name), word => String.length(word) >= 3 && !Array.contains(GENERIC, word)),
			word => Array.contains(own, word)
		)
	})
	return Option.map(
		Option.orElse(
			Array.findFirst(named, match => Array.some(match.modes ?? [], mode => Array.contains(RAIL, mode))),
			() => Array.head(named)
		),
		match =>
			({
				...Option.match(Option.fromUndefinedOr(match.tz), {onNone: () => ({}), onSome: timeZone => ({timeZone})}),
				code: match.id,
				latitude: match.lat,
				longitude: match.lon,
				name: pipe(
					String.toLowerCase(match.name),
					String.split(' '),
					Array.map(word => `${String.toUpperCase(String.slice(0, 1)(word))}${String.slice(1)(word)}`),
					Array.join(' ')
				)
			}) satisfies Place
	)
}

// Airports come from an open dataset with their zone and coordinates; stations from Transitous, which also names the Trenitalia station code.
export class Places extends Context.Service<
	Places,
	{
		readonly airport: (code: string) => Effect.Effect<Place, BookingsError>
		readonly station: (name: string) => Effect.Effect<Place, BookingsError>
	}
>()('@deslop/trips/services/bookings/lib/places') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, AirportIndex)
			const clock = yield* Clock.Clock

			const download = Effect.gen(function* () {
				const all = yield* pipe(
					client.get('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json'),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Record(Schema.String, Schema.Unknown))),
					Effect.timeout('60 seconds'),
					Effect.retry({schedule: Schedule.exponential('2 seconds'), times: 2})
				)
				const index = airportIndex(all, yield* Clock.currentTimeMillis)
				yield* store.set('airports', index)
				return index
			})

			const index = yield* Effect.cachedWithTTL(
				Effect.gen(function* () {
					const saved = yield* Effect.orElseSucceed(store.get('airports'), Option.none<AirportIndex>)
					const now = yield* Clock.currentTimeMillis
					return yield* Option.match(
						Option.filter(saved, found => now - found.fetchedAt < 30 * DAY),
						{
							// A stale copy still answers when GitHub does not.
							onNone: () => Effect.catch(download, error => Effect.mapError(Effect.fromOption(saved), () => error)),
							onSome: Effect.succeed
						}
					)
				}),
				exit =>
					Exit.match(exit, {
						onFailure: () => Duration.zero,
						onSuccess: found =>
							Duration.millis(Number.max(0, found.fetchedAt + 30 * DAY - clock.currentTimeMillisUnsafe()))
					})
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
					const airport = yield* Effect.mapError(
						Effect.fromOption(Record.get(airports.airports, String.toUpperCase(String.trim(code)))),
						() => BookingsError.make({message: `Unknown airport code ${code}.`})
					)
					return {
						city: airport.city,
						code: airport.iata,
						latitude: airport.lat,
						longitude: airport.lon,
						name: airport.name,
						timeZone: airport.tz
					} satisfies Place
				}),
				station: Effect.fn('Places.station')(function* (name) {
					return Option.getOrElse(
						yield* pipe(
							Cache.get(stations, String.toLowerCase(String.trim(name))),
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
