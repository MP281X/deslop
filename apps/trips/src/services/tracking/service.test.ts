import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	DateTime,
	Deferred,
	Duration,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	MutableRef,
	Option,
	Order,
	Queue,
	Record,
	Schema,
	Struct,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {layerDataStore} from '@deslop/runtime/server/store'

import {FlightAware} from './lib/flightaware.ts'

import {FlightId, Flight, Place} from '#services/flights/schema.ts'
import {Flights} from '#services/flights/service.ts'
import {FaFlight} from '#services/tracking/schema.ts'
import {Tracking} from '#services/tracking/service.ts'

// One traveller's ticket for BA 553, three hours out.
function ticket(now: DateTime.Utc, id: FlightId, confirmation: string) {
	return Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(now, Duration.hours(5.5)),
		boardingAt: Option.none(),
		departs: DateTime.addDuration(now, Duration.hours(3)),
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id,
		live: Option.none(),
		number: '553',
		to: Schema.decodeSync(Place)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}),
		travellers: [
			{
				boardingGroup: Option.none(),
				confirmation: Option.some(confirmation),
				name: Option.none(),
				seat: Option.none(),
				status: 'confirmed',
				ticket: Option.none()
			}
		]
	})
}

it.layer(NodeServices.layer)(test =>
	test.effect(
		'two tickets of a late flight cost one lookup and one of its inbound plane, and each gets the report with its cause',
		Effect.fnUntraced(function* () {
			const now = yield* DateTime.now
			const tickets: Flight[] = [
				ticket(now, FlightId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'), 'ABC123'),
				ticket(now, FlightId.make('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'), 'DEF456')
			]
			const operation = yield* Schema.decodeEffect(FaFlight)({
				cancelled: false,
				diverted: false,
				estimated_out: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(230))),
				fa_flight_id: 'BAW553-1761600000-schedule-0001',
				gate_origin: 'B12',
				inbound_fa_flight_id: 'BAW552-1761590000-schedule-0001',
				origin: {code_iata: 'FCO'},
				scheduled_out: DateTime.formatIso(DateTime.addDuration(now, Duration.hours(3)))
			})
			const inbound = yield* Schema.decodeEffect(FaFlight)({
				cancelled: false,
				diverted: false,
				estimated_in: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(160))),
				fa_flight_id: 'BAW552-1761590000-schedule-0001',
				scheduled_in: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(110)))
			})
			const lookups = MutableRef.make(0)
			const asked = yield* Deferred.make<void>()
			const askedInbound = yield* Deferred.make<void>()
			const replaced = yield* Queue.unbounded<Flight>()
			// The round that starts with the service finds both tickets due.
			yield* Layer.build(
				pipe(
					Tracking.layer,
					Layer.provide(
						Layer.mock(Flights, {
							find: id => Effect.succeed(Array.findFirst(tickets, flight => flight.id === id)),
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
							),
							operation: Option.some(() =>
								pipe(
									Effect.sync(() => MutableRef.increment(lookups)),
									Effect.andThen(Deferred.succeed(askedInbound, undefined)),
									Effect.as({flights: [inbound]})
								)
							)
						})
					),
					Layer.provide(layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()))
				)
			)
			// Each lookup holds FlightAware's six-second gap: the flight's, then its inbound plane's, before either report is saved.
			yield* Deferred.await(asked)
			yield* TestClock.adjust('6 seconds')
			yield* Deferred.await(askedInbound)
			yield* TestClock.adjust('6 seconds')
			const reports = yield* Queue.takeBetween(replaced, 2, 2)
			assert.strictEqual(MutableRef.get(lookups), 2)
			assert.deepStrictEqual(
				Array.map(reports, flight => [
					flight.id,
					Option.flatMap(flight.live, live => live.departureGate),
					Option.flatMap(flight.live, live => Option.map(live.inboundDelay, Duration.toMinutes))
				]),
				Array.map(tickets, flight => [flight.id, Option.some('B12'), Option.some(50)])
			)
		}, Effect.scoped)
	)
)

// FlightAware's report of BA `number` twenty minutes late, waiting for the same plane flying in.
function lateReport(now: DateTime.Utc, number: string) {
	return Schema.decodeEffect(FaFlight)({
		cancelled: false,
		diverted: false,
		estimated_out: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(200))),
		fa_flight_id: `BAW${number}-1761600000-schedule-0001`,
		inbound_fa_flight_id: 'BAW552-1761590000-schedule-0001',
		origin: {code_iata: 'FCO'},
		scheduled_out: DateTime.formatIso(DateTime.addDuration(now, Duration.hours(3)))
	})
}

it.layer(NodeServices.layer)(test =>
	test.effect(
		'two late flights waiting for the same plane ask about it once',
		Effect.fnUntraced(function* () {
			const now = yield* DateTime.now
			const first = ticket(now, FlightId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'), 'ABC123')
			const second = Flight.make({
				...Struct.pick(
					ticket(now, FlightId.make('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'), 'DEF456'),
					Struct.keys(Flight.fields)
				),
				number: '557'
			})
			const reports: Readonly<Record<string, FaFlight>> = {
				BA553: yield* lateReport(now, '553'),
				BA557: yield* lateReport(now, '557')
			}
			const inbound = yield* Schema.decodeEffect(FaFlight)({
				cancelled: false,
				diverted: false,
				estimated_in: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(160))),
				fa_flight_id: 'BAW552-1761590000-schedule-0001',
				scheduled_in: DateTime.formatIso(DateTime.addDuration(now, Duration.minutes(110)))
			})
			const asked = MutableRef.make(Array.empty<string>())
			const replaced = yield* Queue.unbounded<Flight>()
			yield* Layer.build(
				pipe(
					Tracking.layer,
					Layer.provide(
						Layer.mock(Flights, {
							find: id => Effect.succeed(Array.findFirst([first, second], flight => flight.id === id)),
							list: Effect.succeed([first, second]),
							replace: (_, after) => Queue.offer(replaced, after)
						})
					),
					Layer.provide(
						Layer.mock(FlightAware, {
							flights: Option.some((designator: string) =>
								Effect.sync(() => {
									MutableRef.update(asked, Array.append(designator))
									return {flights: Option.toArray(Record.get(reports, designator))}
								})
							),
							operation: Option.some((id: string) =>
								Effect.sync(() => {
									MutableRef.update(asked, Array.append(id))
									return {flights: [inbound]}
								})
							)
						})
					),
					Layer.provide(layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()))
				)
			)
			// Both checks start together, so both flights' inbound reads queue behind FlightAware's gap.
			const saved = yield* pipe(replaced, Queue.takeBetween(2, 2), Effect.forkChild)
			yield* Effect.forEach(Array.range(1, 6), () => TestClock.adjust('6 seconds'), {concurrency: 1, discard: true})
			const flights = yield* Fiber.join(saved)
			assert.deepStrictEqual(Array.sort(MutableRef.get(asked), Order.String), [
				'BA553',
				'BA557',
				'BAW552-1761590000-schedule-0001'
			])
			assert.deepStrictEqual(
				Array.map(flights, flight =>
					Option.flatMap(flight.live, live => Option.map(live.inboundDelay, Duration.toMinutes))
				),
				[Option.some(50), Option.some(50)]
			)
		}, Effect.scoped)
	)
)
