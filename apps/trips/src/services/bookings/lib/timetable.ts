import {Array, Cause, Context, DateTime, Duration, Effect, Layer, Option, Order, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {Places, stationName} from './places.ts'
import {bySurety, instantOf, segmentOf} from './utils.ts'
import type {Surety} from './utils.ts'

import {BookedPlace, BookingsError, TransitRuns, TransitTrip, TrainStop} from '#services/bookings/schema.ts'
import type {ExtractedItem, Place, TransitStop} from '#services/bookings/schema.ts'

type RunCandidate = Surety & {
	readonly gap: Duration.Duration
	readonly run: TransitRuns['stopTimes'][number]
	readonly stops: readonly TransitStop[]
}

const surestRun = Order.combine(
	bySurety,
	Order.mapInput(Duration.Order, (candidate: RunCandidate) => candidate.gap)
)

function place(stop: TransitStop) {
	return BookedPlace.make({
		address: Option.none(),
		city: Option.none(),
		code: Option.some(stop.stopId),
		latitude: Option.some(stop.lat),
		longitude: Option.some(stop.lon),
		name: stationName(stop.name),
		timeZone: stop.tz
	})
}

export class Timetable extends Context.Service<Timetable>()('@deslop/trips/services/bookings/lib/timetable', {
	make: Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const places = yield* Places
		function get<A, I>(path: string, params: Record<string, string | number>, schema: Schema.Codec<A, I>) {
			return pipe(
				HttpClientRequest.get(`https://api.transitous.org/api/v1/${path}`, {
					headers: {'user-agent': 'Trips (+https://trips.mp281x.xyz)'},
					urlParams: params
				}),
				client.execute,
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
				Effect.timeout('30 seconds')
			)
		}
		return {
			resolve: Effect.fn('Timetable.resolve')(function* (item: Extract<ExtractedItem, {kind: 'train'}>) {
				return yield* Effect.mapError(
					Effect.gen(function* () {
						const station = yield* Effect.fromOption(yield* places.station(item.from))
						const code = yield* Effect.fromOption(station.code)
						// Only the ranking's exact stop id needs this lookup; without it the run's stops still rank by name.
						const destination = yield* Effect.catch(places.station(item.to), cause =>
							Effect.as(
								Effect.logWarning('The destination station could not be looked up', cause),
								Option.none<Place>()
							)
						)
						// A time with an offset needs no zone; a wall time reads in the station's.
						const at = yield* Option.match(instantOf(item.departure, station.timeZone), {
							onNone: () => BookingsError.make({message: `The time ${item.departure} could not be read.`}),
							onSome: Effect.succeed
						})
						const runs = yield* get(
							'stoptimes',
							{n: 1000, stopId: code, time: DateTime.formatIso(DateTime.subtractDuration(at, Duration.hours(3)))},
							TransitRuns
						)
						// The runs of that number nearest the booked time; of those that serve both booked stations, the one whose stops match surest, then the nearest, is the train.
						const matches = yield* pipe(
							runs.stopTimes,
							Array.filter(
								candidate =>
									candidate.tripShortName === item.trainNumber &&
									pipe(
										DateTime.distance(candidate.place.departure, at),
										Duration.abs,
										Duration.isLessThanOrEqualTo(Duration.hours(3))
									)
							),
							Array.sort(
								Order.mapInput(Duration.Order, (candidate: TransitRuns['stopTimes'][number]) =>
									Duration.abs(DateTime.distance(candidate.place.departure, at))
								)
							),
							Array.take(3),
							Effect.forEach(
								run =>
									Effect.map(get('trip', {tripId: run.tripId}, TransitTrip), trip =>
										Option.map(
											segmentOf(
												// A trip with a change of vehicle comes as several legs, each ending where the next begins.
												pipe(
													trip.legs,
													Array.flatMap(leg => [leg.from, ...leg.intermediateStops, leg.to]),
													Array.dedupeAdjacentWith((left, right) => left.stopId === right.stopId)
												),
												{code: Option.some(code), name: item.from},
												{code: Option.flatMap(destination, found => found.code), name: item.to}
											),
											segment => ({
												gap: Duration.abs(DateTime.distance(run.place.departure, at)),
												rank: segment.rank,
												run,
												stops: segment.stops
											})
										)
									),
								{concurrency: 1}
							)
						)
						const found = yield* pipe(
							matches,
							Array.getSomes,
							Array.match({
								onEmpty: () => Option.none<RunCandidate>(),
								onNonEmpty: viable => Option.some(Array.min(viable, surestRun))
							}),
							Effect.fromOption
						)
						const from = yield* Effect.fromOption(Array.head(found.stops))
						const to = yield* Effect.fromOption(Array.last(found.stops))
						return {
							arrives: yield* Effect.fromOption(to.arrival),
							departs: yield* Effect.fromOption(from.departure),
							from: place(from),
							operator: found.run.agencyName,
							service: found.run.routeShortName,
							stops: Array.map(found.stops, stop =>
								TrainStop.make({
									arrives: stop.arrival,
									code: Option.some(stop.stopId),
									departs: stop.departure,
									name: stationName(stop.name),
									timeZone: Option.some(stop.tz)
								})
							),
							to: place(to)
						}
					}),
					// A missing run, station or stop means the timetable has no such train; a lookup that explains itself keeps its words; anything else is Transitous failing.
					cause => {
						if (Schema.is(BookingsError)(cause)) return cause
						if (Cause.isNoSuchElementError(cause)) {
							return BookingsError.make({
								cause,
								message: `Train ${item.trainNumber} not found on ${DateTime.format(DateTime.makeUnsafe(`${String.slice(0, 10)(item.departure)}T12:00:00Z`), {day: 'numeric', locale: 'en-GB', month: 'short', timeZone: 'UTC'})}.`
							})
						}
						return BookingsError.make({cause, message: `The timetable did not answer for train ${item.trainNumber}.`})
					}
				)
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
