import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, MutableRef, Option, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'

import type {ExtractedFlight, ExtractedFlights} from '#services/flights/schema.ts'
import {TicketSource, Place, PlaceCode} from '#services/flights/schema.ts'
import {Flights} from '#services/flights/service.ts'

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
		seat: Option.none(),
		status: 'confirmed',
		to
	} satisfies ExtractedFlight
}

const next = MutableRef.make<ExtractedFlights>([])

// The test sets what the next shared ticket reads as; each test gets its own scratch database.
const flightsLayer = pipe(
	Flights.layer,
	Layer.provide(Layer.mock(Extractor, {read: () => Effect.sync(() => MutableRef.get(next))})),
	Layer.provide(
		Layer.mock(Places, {
			airport: code =>
				Effect.succeed(
					Place.make({
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

function share(document: ExtractedFlights) {
	MutableRef.set(next, document)
	return Effect.flatMap(Flights, flights => flights.save(USER, TicketSource.cases.text.make({text: 'ticket'})))
}

it.layer(flightsLayer)(test =>
	test.effect(
		'a delete removes only the flight it names',
		Effect.fnUntraced(function* () {
			const flights = yield* Flights
			yield* share([flight('553', 'FCO', 'LHR', '2026-11-19T08:00', 'ONE')])
			const shown = yield* flights.list
			if (!Array.isReadonlyArrayNonEmpty(shown)) return assert.fail('The first ticket was not saved.')
			// Another ticket is shared while the phone still shows the first.
			yield* share([flight('554', 'LHR', 'FCO', '2026-11-19T20:00', 'TWO')])
			yield* flights.remove(Array.headNonEmpty(shown).id)
			assert.deepStrictEqual(
				Array.map(yield* flights.list, saved => saved.number),
				['554']
			)
		})
	)
)
