import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Effect, FileSystem, Layer, MutableRef, Option, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'
import {Timetable} from './lib/timetable.ts'

import {journeysOf} from '#services/bookings/lib/utils.ts'
import type {ExtractedItem, ExtractedItems} from '#services/bookings/schema.ts'
import {BookedPlace, Booking, BookingSource, PlaceCode} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

const USER = UserId.make('github:1')

function place(name: string) {
	return BookedPlace.make({
		address: Option.none(),
		city: Option.none(),
		code: Option.some(PlaceCode.make(name)),
		latitude: Option.none(),
		longitude: Option.none(),
		name,
		timeZone: 'UTC'
	})
}

function train(trainNumber: string, from: string, to: string, departure: string, confirmation: string) {
	return {
		coach: Option.none(),
		confirmation: Option.some(confirmation),
		departure,
		from,
		kind: 'train',
		seat: Option.none(),
		status: 'confirmed',
		to,
		trainNumber
	} satisfies ExtractedItem
}

const next = MutableRef.make<ExtractedItems>([])

// The test sets what the next shared ticket reads as; trains run fifty minutes between the stations the ticket prints, at the time it prints; each test gets its own scratch database.
const bookingsLayer = pipe(
	Bookings.layer,
	Layer.provide(Layer.mock(Extractor, {read: () => Effect.sync(() => MutableRef.get(next))})),
	Layer.provide(Layer.mock(Places, {airport: code => Effect.succeed(place(code))})),
	Layer.provide(
		Layer.mock(Timetable, {
			resolve: item => {
				const departs = DateTime.makeUnsafe(`${item.departure}Z`)
				return Effect.succeed({
					arrives: DateTime.addDuration(departs, Duration.minutes(50)),
					departs,
					from: place(item.from),
					operator: 'Trenitalia',
					service: `FR ${item.trainNumber}`,
					stops: [],
					to: place(item.to)
				})
			}
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
		'a delete removes the legs the phone showed and none that joined their journey since',
		Effect.fnUntraced(function* () {
			const bookings = yield* Bookings
			yield* share([train('1', 'Milano', 'Verona', '2026-11-19T08:00', 'ONE')])
			const shown = yield* bookings.list
			if (!Array.isReadonlyArrayNonEmpty(shown)) return assert.fail('The first ticket was not saved.')
			// Another ticket's connection at Verona joins the journey on the server while the phone still shows the first.
			yield* share([
				train('2', 'Bologna', 'Verona', '2026-11-19T09:00', 'TWO'),
				train('3', 'Verona', 'Venezia', '2026-11-19T10:00', 'TWO')
			])
			assert.deepStrictEqual(
				Array.map(journeysOf(yield* bookings.list), journey => journey.length),
				[2, 1]
			)
			yield* bookings.remove(Array.map(shown, booking => booking.id))
			assert.deepStrictEqual(
				pipe(
					yield* bookings.list,
					Array.filter(Booking.isAnyOf(['train'])),
					Array.map(booking => booking.service)
				),
				['FR 2', 'FR 3']
			)
		})
	)
)
