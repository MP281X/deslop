import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Layer, Option, Ref, Result, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {Extractor} from '#services/bookings/lib/extraction.ts'
import {Places} from '#services/bookings/lib/places.ts'
import type {BookingSource, ExtractedItems} from '#services/bookings/schema.ts'
import {BookingList, BookingsError} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

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

it.layer(Layer.merge(NodeCrypto.layer, KeyValueStore.layerMemory))(test => {
	test.effect(
		'saves text and screenshots through the same reservation merge and persists the result',
		Effect.fnUntraced(function* () {
			const seen = yield* Ref.make<BookingSource[]>([])
			const extractor = Extractor.of({
				read: Effect.fnUntraced(function* (source: BookingSource) {
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
			const text = {text: 'BA553 FCO LHR, 10 November 2026, 16:00–18:00, seat 12A'}
			const image = {image: new Uint8Array([255, 216, 255, 217])}
			const first = yield* bookings.save(text)
			const second = yield* bookings.save(image)
			assert.deepStrictEqual(yield* Ref.get(seen), [text, image])
			assert.deepStrictEqual(second, first)
			assert.lengthOf(yield* bookings.list, 1)
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, BookingList)
			assert.deepStrictEqual(yield* store.get('bookings'), Option.some(second))
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
			const saved = yield* bookings.save({text: 'Existing booking'})
			yield* Ref.set(items, [
				{...FLIGHT, flightNumber: '554'},
				{...FLIGHT, from: 'BAD'}
			])
			assert.isTrue(Result.isFailure(yield* Effect.result(bookings.save({image: new Uint8Array([1])}))))
			assert.deepStrictEqual(yield* bookings.list, saved)
			yield* Ref.set(rejected, true)
			assert.deepStrictEqual(yield* Effect.result(bookings.save({image: new Uint8Array([1])})), Result.fail(failure))
			assert.deepStrictEqual(yield* bookings.list, saved)
		})
	)
})
