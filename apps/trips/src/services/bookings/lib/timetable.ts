import type {Schema} from 'effect'
import {Array, Cause, Context, DateTime, Duration, Effect, Layer, Match, Number, Option, Order, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {Places, stationName, stationNamesMatch} from './places.ts'
import {instantOf} from './utils.ts'

import {BookedPlace, BookingsError, TransitRuns, TransitTrip, TrainStop} from '#services/bookings/schema.ts'
import type {ExtractedItem} from '#services/bookings/schema.ts'

function segmentOf<A extends {readonly name: string; readonly stopId: string}>(
	stops: readonly A[],
	from: string,
	to: string,
	code: string
) {
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
						const at = yield* Effect.fromOption(instantOf(item.departure, yield* Effect.fromOption(station.timeZone)))
						const runs = yield* get(
							'stoptimes',
							{n: 1000, stopId: code, time: DateTime.formatIso(DateTime.subtractDuration(at, Duration.hours(3)))},
							TransitRuns
						)
						const run = yield* Effect.fromOption(
							pipe(
								runs.stopTimes,
								Array.filter(
									candidate =>
										candidate.tripShortName === item.trainNumber &&
										Math.abs(Date.parse(candidate.place.departure) - DateTime.toEpochMillis(at)) <= 10_800_000
								),
								Array.match({
									onEmpty: () => Option.none<TransitRuns['stopTimes'][number]>(),
									onNonEmpty: candidates =>
										Option.some(
											Array.min(
												candidates,
												Order.mapInput(Number.Order, candidate =>
													Math.abs(Date.parse(candidate.place.departure) - DateTime.toEpochMillis(at))
												)
											)
										)
								})
							)
						)

						const leg = (yield* get('trip', {tripId: run.tripId}, TransitTrip)).legs[0]
						const segment = yield* Effect.fromOption(
							segmentOf([leg.from, ...leg.intermediateStops, leg.to], item.from, item.to, code)
						)
						const from = yield* Effect.fromOption(Array.head(segment))
						const to = yield* Effect.fromOption(Array.last(segment))
						function place(stop: typeof from) {
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
						return {
							arrives: DateTime.makeUnsafe(yield* Effect.fromOption(to.arrival)),
							departs: DateTime.makeUnsafe(yield* Effect.fromOption(from.departure)),
							from: place(from),
							operator: run.agencyName,
							service: run.routeShortName,
							stops: Array.map(segment, stop =>
								TrainStop.make({
									arrives: Option.flatMap(stop.arrival, DateTime.make),
									code: Option.some(stop.stopId),
									departs: Option.flatMap(stop.departure, DateTime.make),
									name: stationName(stop.name)
								})
							),
							to: place(to)
						}
					}),
					// A missing run, station or stop means the timetable has no such train; anything else is Transitous failing.
					cause =>
						BookingsError.make({
							cause,
							message: pipe(
								Match.value(cause),
								Match.when(
									Cause.isNoSuchElementError,
									() =>
										`Train ${item.trainNumber} not found on ${DateTime.format(DateTime.makeUnsafe(item.departure), {day: 'numeric', locale: 'en-GB', month: 'short', timeZone: 'UTC'})}.`
								),
								Match.orElse(() => `The timetable did not answer for train ${item.trainNumber}.`)
							)
						})
				)
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
