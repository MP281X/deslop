import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, Option, Ref, Result, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server/store'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'

import type {BookingSource, ExtractedItems} from '#services/bookings/schema.ts'
import {BookingList, BookingsError} from '#services/bookings/schema.ts'
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

const places = Layer.succeed(
	Places,
	Places.of({
		airport: code => {
			if (code === 'BAD') return BookingsError.make({message: 'Unknown airport code.'})
			return Effect.succeed({code, name: code, timeZone: 'UTC'})
		},
		station: name => Effect.succeed({name, timeZone: 'UTC'})
	})
)

it.layer(Layer.mergeAll(NodeCrypto.layer, NodeServices.layer, KeyValueStore.layerMemory))(test => {
	test.effect(
		'saves text and screenshots through the same reservation merge and persists the result',
		Effect.fnUntraced(function* () {
			const seen = yield* Ref.make<BookingSource[]>([])
			const extractor = Extractor.of({
				read: Effect.fnUntraced(function* (userId: string, source: BookingSource) {
					assert.strictEqual(userId, USER)
					yield* Ref.update(seen, Array.append(source))
					return [FLIGHT]
				})
			})
			const bookings = Context.get(
				yield* Layer.build(
					pipe(Bookings.layer, Layer.provide(places), Layer.provide(Layer.succeed(Extractor, extractor)))
				),
				Bookings
			)
			const first: BookingSource = {_tag: 'text', text: 'BA553 FCO LHR, 10 November 2026, 16:00–18:00, seat 12A'}
			const second: BookingSource = {_tag: 'image', image: new Uint8Array([255, 216, 255, 217])}
			yield* bookings.save(USER, first)
			yield* bookings.save(USER, second)
			assert.deepStrictEqual(yield* Ref.get(seen), [first, second])
			assert.lengthOf(yield* bookings.list, 1)
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, BookingList)
			assert.deepStrictEqual(yield* store.get('bookings'), Option.some(yield* bookings.list))
		})
	)

	test.effect(
		'never saves half a screenshot and leaves existing bookings intact on extraction failure',
		Effect.fnUntraced(function* () {
			const items = yield* Ref.make<ExtractedItems>([FLIGHT])
			const rejected = yield* Ref.make(false)
			const failure = BookingsError.make({message: 'The screenshot could not be read.'})
			const extractor = Extractor.of({
				read: Effect.fnUntraced(function* () {
					if (yield* Ref.get(rejected)) return yield* failure
					return yield* Ref.get(items)
				})
			})
			const bookings = Context.get(
				yield* Layer.build(
					pipe(Bookings.layer, Layer.provide(places), Layer.provide(Layer.succeed(Extractor, extractor)))
				),
				Bookings
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
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const extractor = Extractor.of({read: () => Effect.succeed([FLIGHT])})
			function open(path: string) {
				return Layer.build(
					pipe(
						Bookings.layer,
						Layer.provide(places),
						Layer.provide(Layer.succeed(Extractor, extractor)),
						Layer.provide(layerKeyValueStore(path))
					)
				)
			}
			yield* Effect.scoped(
				Effect.gen(function* () {
					const bookings = Context.get(yield* open(directory), Bookings)
					yield* bookings.save(USER, {_tag: 'text', text: 'BA553 FCO LHR, 10 November 2026, 16:00–18:00'})
					const saved = yield* bookings.list
					assert.lengthOf(saved, 1)
					yield* bookings.remove(Option.getOrThrow(Array.head(saved)).id)
					assert.deepStrictEqual(yield* bookings.list, [])
				})
			)
			const store = KeyValueStore.toSchemaStore(
				Context.get(yield* Layer.build(layerKeyValueStore(directory)), KeyValueStore.KeyValueStore),
				BookingList
			)
			assert.deepStrictEqual(yield* store.get('bookings'), Option.some([]))
			assert.deepStrictEqual(yield* Context.get(yield* open(directory), Bookings).list, [])
		})
	)
})
