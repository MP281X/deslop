import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, MutableRef, Option, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'

import type {ExtractedItem, ExtractedItems} from '#services/bookings/schema.ts'
import {Booking, BookingSource, Place, PlaceCode} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

const USER = UserId.make('github:1')

function flight(number: string, from: string, to: string, departure: string, confirmation: string) {
	return {
		airlineCode: 'BA',
		airlineName: 'British Airways',
		arrival: `${String.slice(0, 11)(departure)}23:00`,
		boarding: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.some(confirmation),
		departure,
		flightNumber: number,
		from,
		kind: 'flight',
		seat: Option.none(),
		status: 'confirmed',
		to
	} satisfies ExtractedItem
}

const next = MutableRef.make<ExtractedItems>([])

// The test sets what the next shared ticket reads as; each test gets its own scratch database.
const bookingsLayer = pipe(
	Bookings.layer,
	Layer.provide(Layer.mock(Extractor, {read: () => Effect.sync(() => MutableRef.get(next))})),
	Layer.provide(
		Layer.mock(Places, {
			airport: code =>
				Effect.succeed(
					Place.make({
						address: Option.none(),
						city: Option.none(),
						code: Option.some(PlaceCode.make(code)),
						latitude: Option.none(),
						longitude: Option.none(),
						name: code,
						timeZone: 'UTC'
					})
				)
		})
	),
	Layer.provide(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provide(Layer.merge(NodeServices.layer, SecureRandom.layerWebCrypto))
)

function share(document: ExtractedItems) {
	MutableRef.set(next, document)
	return Effect.flatMap(Bookings, bookings => bookings.save(USER, BookingSource.cases.text.make({text: 'ticket'})))
}

it.layer(bookingsLayer)(test =>
	test.effect(
		'a delete removes only the booking it names',
		Effect.fnUntraced(function* () {
			const bookings = yield* Bookings
			yield* share([flight('553', 'FCO', 'LHR', '2026-11-19T08:00', 'ONE')])
			const shown = yield* bookings.list
			if (!Array.isReadonlyArrayNonEmpty(shown)) return assert.fail('The first ticket was not saved.')
			// Another ticket is shared while the phone still shows the first.
			yield* share([flight('554', 'LHR', 'FCO', '2026-11-19T20:00', 'TWO')])
			yield* bookings.remove(Array.headNonEmpty(shown).id)
			assert.deepStrictEqual(
				pipe(
					yield* bookings.list,
					Array.filter(Booking.isAnyOf(['flight'])),
					Array.map(booking => booking.number)
				),
				['554']
			)
		})
	)
)
