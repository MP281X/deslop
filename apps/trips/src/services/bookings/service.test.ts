import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Layer, Option, Queue, Ref, Result, Schema, Stream, Struct, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {SqlClient} from 'effect/sql'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'

import type {BookingSource, ExtractedItems} from '#services/bookings/schema.ts'
import {BookingsError, BookingsEvent, Flight} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

const USER = 'github:1'

const FLIGHT = {
	airlineCode: 'BA',
	airlineName: 'British Airways',
	arrival: '2026-11-10T18:00',
	departure: '2026-11-10T16:00',
	flightNumber: '553',
	from: 'FCO',
	kind: 'flight',
	seat: '12A',
	status: 'confirmed',
	to: 'LHR'
} as const

const places = Places.of({
	airport: code => {
		if (code === 'BAD') return BookingsError.make({message: 'Unknown airport code.'})
		return Effect.succeed({code, name: code, timeZone: 'UTC'})
	},
	station: name => Effect.succeed({name, timeZone: 'UTC'})
})

const memory = Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)

type Database = Layer.Success<typeof memory>

// A restart builds the service again over the same database.
const open = Effect.fnUntraced(function* (database: Context.Context<Database>, extractor: typeof Extractor.Service) {
	return Context.get(
		yield* Layer.build(
			pipe(
				Bookings.layer,
				Layer.provide(Layer.succeedContext(database)),
				Layer.provide(Layer.succeed(Places, places)),
				Layer.provide(Layer.succeed(Extractor, extractor))
			)
		),
		Bookings
	)
})

// The events the phone reads, collected from now on.
const watch = Effect.fnUntraced(function* (bookings: typeof Bookings.Service) {
	const events = yield* Queue.unbounded<BookingsEvent>()
	yield* Effect.forkScoped(Stream.runForEach(bookings.events, event => Queue.offer(events, event)))
	return events
})

// The next event, as the wire carries it.
function next(events: Queue.Dequeue<BookingsEvent>) {
	return Effect.flatMap(Queue.take(events), Schema.encodeEffect(BookingsEvent))
}

function tracked(flight: Flight) {
	return Flight.make({
		...Struct.pick(flight, Struct.keys(Flight.fields)),
		live: Option.some({checkedAt: 1, departureGate: 'B12', state: 'scheduled' as const})
	})
}

it.layer(NodeCrypto.layer)('Bookings', test => {
	test.effect(
		'saves text and screenshots through the same reservation merge and persists the result',
		Effect.fnUntraced(function* () {
			const seen = yield* Ref.make<BookingSource[]>([])
			const bookings = yield* open(
				yield* Layer.build(memory),
				Extractor.of({
					read: Effect.fnUntraced(function* (userId: string, source: BookingSource) {
						assert.strictEqual(userId, USER)
						yield* Ref.update(seen, Array.append(source))
						return [FLIGHT]
					})
				})
			)
			const first: BookingSource = {_tag: 'text', text: 'BA553 FCO LHR, 10 November 2026, 16:00–18:00, seat 12A'}
			const second: BookingSource = {_tag: 'image', image: new Uint8Array([255, 216, 255, 217])}
			yield* bookings.save(USER, first)
			yield* bookings.save(USER, second)
			assert.deepStrictEqual(yield* Ref.get(seen), [first, second])
			assert.lengthOf(yield* bookings.list, 1)
		})
	)

	test.effect(
		'never saves half a screenshot and leaves existing bookings intact on extraction failure',
		Effect.fnUntraced(function* () {
			const items = yield* Ref.make<ExtractedItems>([FLIGHT])
			const rejected = yield* Ref.make(false)
			const failure = BookingsError.make({message: 'The screenshot could not be read.'})
			const bookings = yield* open(
				yield* Layer.build(memory),
				Extractor.of({
					read: Effect.fnUntraced(function* () {
						if (yield* Ref.get(rejected)) return yield* failure
						return yield* Ref.get(items)
					})
				})
			)
			yield* bookings.save(USER, {_tag: 'text', text: 'Existing booking'})
			const saved = yield* bookings.list
			yield* Ref.set(items, [
				{...FLIGHT, flightNumber: '554'},
				{...FLIGHT, from: 'BAD'}
			])
			assert.isTrue(
				Result.isFailure(yield* Effect.result(bookings.save(USER, {_tag: 'image', image: new Uint8Array([1])})))
			)
			assert.deepStrictEqual(yield* bookings.list, saved)
			yield* Ref.set(items, [])
			assert.isTrue(Result.isFailure(yield* Effect.result(bookings.save(USER, {_tag: 'text', text: 'No booking'}))))
			assert.deepStrictEqual(yield* bookings.list, saved)
			yield* Ref.set(rejected, true)
			assert.deepStrictEqual(
				yield* Effect.result(bookings.save(USER, {_tag: 'image', image: new Uint8Array([1])})),
				Result.fail(failure)
			)
			assert.deepStrictEqual(yield* bookings.list, saved)
		})
	)

	test.effect(
		'removes a booking from memory and from the store a restart reads',
		Effect.fnUntraced(function* () {
			const database = yield* Layer.build(memory)
			const extractor = Extractor.of({read: () => Effect.succeed([FLIGHT])})
			const id = yield* Effect.scoped(
				Effect.gen(function* () {
					const bookings = yield* open(database, extractor)
					const events = yield* watch(bookings)
					assert.deepStrictEqual(yield* next(events), {removed: [], reset: true, upserted: []})
					yield* bookings.save(USER, {_tag: 'text', text: 'BA553 FCO LHR, 10 November 2026, 16:00–18:00, seat 12A'})
					const written = yield* next(events)
					assert.containsSubset(written, {
						removed: [],
						reset: false,
						upserted: [{_tag: 'flight', airlineCode: 'BA', number: '553', seat: '12A', status: 'confirmed'}]
					})
					return Option.getOrThrow(Array.head(written.upserted)).id
				})
			)
			const rows = yield* pipe(SqlClient.SqlClient, Effect.flatMap(sql => sql<{id: string; number: string}>`SELECT id, number FROM flights`), Effect.provideContext(database))
			assert.deepStrictEqual(rows, [{id, number: '553'}])
			const bookings = yield* open(database, extractor)
			const events = yield* watch(bookings)
			assert.containsSubset(yield* next(events), {reset: true, upserted: [{id, number: '553'}]})
			yield* bookings.remove(id)
			assert.deepStrictEqual(yield* next(events), {removed: [id], reset: false, upserted: []})
		})
	)

	test.effect(
		'keeps a live answer only for the booking it was read from',
		Effect.fnUntraced(function* () {
			const seat = yield* Ref.make('12A')
			const bookings = yield* open(
				yield* Layer.build(memory),
				Extractor.of({read: () => Effect.map(Ref.get(seat), found => [{...FLIGHT, seat: found}])})
			)
			const stored = Effect.map(bookings.list, list =>
				Option.getOrThrow(Array.findFirst(list, (booking): booking is Flight => booking._tag === 'flight'))
			)
			yield* bookings.save(USER, {_tag: 'text', text: 'BA553'})
			const read = yield* stored
			yield* Ref.set(seat, '14A')
			yield* bookings.save(USER, {_tag: 'text', text: 'BA553, now seat 14A'})
			yield* bookings.replace(read, tracked(read))
			assert.isTrue(Option.isNone((yield* stored).live))
			const current = yield* stored
			yield* bookings.replace(current, tracked(current))
			assert.isTrue(Option.isSome((yield* stored).live))
		})
	)
})
