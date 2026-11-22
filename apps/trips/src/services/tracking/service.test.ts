import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	DateTime,
	Deferred,
	Duration,
	Effect,
	FileSystem,
	Layer,
	MutableRef,
	Option,
	Queue,
	Schema,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {layerDataStore} from '@deslop/runtime/server/store'

import {FlightAware} from './lib/flightaware.ts'

import {BookedPlace, Booking, BookingId, Flight} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {FaFlight} from '#services/tracking/schema.ts'
import {Tracking} from '#services/tracking/service.ts'

// One traveller's ticket for BA 553, three hours out.
function ticket(now: DateTime.Utc, id: BookingId, confirmation: string) {
	return Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(now, Duration.hours(5.5)),
		boardingAt: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.some(confirmation),
		departs: DateTime.addDuration(now, Duration.hours(3)),
		from: Schema.decodeSync(BookedPlace)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id,
		live: Option.none(),
		number: '553',
		seat: Option.none(),
		status: 'confirmed',
		to: Schema.decodeSync(BookedPlace)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'})
	})
}

it.layer(NodeServices.layer)(test =>
	test.effect(
		'two tickets of one flight cost one FlightAware lookup and each gets the report',
		Effect.fnUntraced(function* () {
			const now = yield* DateTime.now
			const tickets: Booking[] = [
				ticket(now, BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'), 'ABC123'),
				ticket(now, BookingId.make('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'), 'DEF456')
			]
			const operation = yield* Schema.decodeEffect(FaFlight)({
				cancelled: false,
				diverted: false,
				fa_flight_id: 'BAW553-1761600000-schedule-0001',
				gate_origin: 'B12',
				origin: {code_iata: 'FCO'},
				scheduled_out: DateTime.formatIso(DateTime.addDuration(now, Duration.hours(3)))
			})
			const lookups = MutableRef.make(0)
			const asked = yield* Deferred.make<void>()
			const replaced = yield* Queue.unbounded<Booking>()
			// The round that starts with the service finds both tickets due.
			yield* Layer.build(
				pipe(
					Tracking.layer,
					Layer.provide(
						Layer.mock(Bookings, {
							find: id => Effect.succeed(Array.findFirst(tickets, booking => booking.id === id)),
							list: Effect.succeed(tickets),
							replace: (_, after) => Queue.offer(replaced, after)
						})
					),
					Layer.provide(
						Layer.mock(FlightAware, {
							flights: Option.some(() =>
								pipe(
									Effect.sync(() => MutableRef.increment(lookups)),
									Effect.andThen(Deferred.succeed(asked, undefined)),
									Effect.as({flights: [operation]})
								)
							)
						})
					),
					Layer.provide(layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()))
				)
			)
			// The first ticket's lookup holds FlightAware's six-second gap before either report is saved.
			yield* Deferred.await(asked)
			yield* TestClock.adjust('6 seconds')
			const reports = yield* Queue.takeBetween(replaced, 2, 2)
			assert.strictEqual(MutableRef.get(lookups), 1)
			assert.deepStrictEqual(
				pipe(
					reports,
					Array.filter(Booking.isAnyOf(['flight'])),
					Array.map(booking => [booking.id, Option.flatMap(booking.live, live => live.departureGate)])
				),
				Array.map(tickets, booking => [booking.id, Option.some('B12')])
			)
		}, Effect.scoped)
	)
)
