import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, MutableRef, Option, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {TicketSource, Place, PlaceCode} from '#contracts'

import {Extractor} from './extraction.ts'
import {Places} from './places.ts'

import type {ExtractedFlight, ExtractedFlights} from '#server/flights/schema.ts'
import {Flights} from '#server/flights/service.ts'

const USER = UserId.make('github:1')

function flight(number: string, from: string, to: string, departure: string, confirmation: string) {
	return {
		airlineCode: 'BA',
		airlineName: 'British Airways',
		arrival: `${String.slice(0, 11)(departure)}23:00`,
		boarding: Option.none(),
		confirmation: Option.some(confirmation),
		departure,
		flightNumber: number,
		from,
		status: 'confirmed',
		to,
		travellers: []
	} satisfies ExtractedFlight
}

// One person's pass for FR 1234, which prints when boarding starts.
function pass(confirmation: string, name: string, seat: string) {
	return {
		...flight('1234', 'BGY', 'STN', '2026-11-23T15:30', confirmation),
		boarding: Option.some('2026-11-23T15:00'),
		travellers: [{boardingGroup: Option.none(), name, seat: Option.some(seat), ticket: Option.none()}]
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

it.layer(flightsLayer)(test =>
	test.effect(
		'passes shared for two people fill one flight with both travellers, each under their own reservation',
		Effect.fnUntraced(function* () {
			yield* share([pass('ABC123', 'Matteo Rossi', '14C')])
			yield* share([pass('XYZ789', 'Anna Bianchi', '14D')])
			// The same pass again, as the reader may list a person in one seat twice, changes nothing.
			yield* share([
				{
					...pass('XYZ789', 'Anna Bianchi', '14D'),
					travellers: [
						...pass('XYZ789', 'Anna Bianchi', '14D').travellers,
						...pass('XYZ789', 'Anna Bianchi', '14D').travellers
					]
				}
			])
			assert.deepStrictEqual(
				Array.map(yield* Effect.flatMap(Flights, flights => flights.list), saved => [saved.number, saved.travellers]),
				[
					[
						'1234',
						[
							{
								boardingGroup: Option.none(),
								boardingPass: true,
								confirmation: Option.some('ABC123'),
								name: Option.some('Matteo Rossi'),
								seat: Option.some('14C'),
								status: 'confirmed',
								ticket: Option.none()
							},
							{
								boardingGroup: Option.none(),
								boardingPass: true,
								confirmation: Option.some('XYZ789'),
								name: Option.some('Anna Bianchi'),
								seat: Option.some('14D'),
								status: 'confirmed',
								ticket: Option.none()
							}
						]
					]
				]
			)
		})
	)
)
