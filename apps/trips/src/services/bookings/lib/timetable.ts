import {Array, Cause, Context, DateTime, Duration, Effect, Layer, Option, Order, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {Places, stationName} from './places.ts'
import {stationNamesMatch, instantOf} from './utils.ts'

import {BookedPlace, BookingsError, TransitRuns, TransitTrip, TrainStop} from '#services/bookings/schema.ts'
import type {ExtractedItem, TransitStop} from '#services/bookings/schema.ts'

function segmentOf(stops: readonly TransitStop[], from: string, to: string, code: string) {
	return pipe(
		stops,
		Array.findFirstIndex(stop => stop.stopId === code || stationNamesMatch(from, stop.name)),
		Option.flatMap(first =>
			pipe(
				stops,
				Array.findFirstIndex((stop, index) => index > first && stationNamesMatch(to, stop.name)),
				Option.map(last => pipe(stops, Array.drop(first), Array.take(last - first + 1)))
			)
		)
	)
}

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
						// The runs of that number nearest the booked time, of which the first that serves both booked stations is the train.
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
												item.from,
												item.to,
												code
											),
											segment => ({run, segment})
										)
									),
								{concurrency: 1}
							)
						)
						const found = yield* Effect.fromOption(Array.head(Array.getSomes(matches)))
						const from = yield* Effect.fromOption(Array.head(found.segment))
						const to = yield* Effect.fromOption(Array.last(found.segment))
						return {
							arrives: yield* Effect.fromOption(to.arrival),
							departs: yield* Effect.fromOption(from.departure),
							from: place(from),
							operator: found.run.agencyName,
							service: found.run.routeShortName,
							stops: Array.map(found.segment, stop =>
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
