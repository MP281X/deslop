import {
	Array,
	Boolean,
	Clock,
	Context,
	Crypto,
	Effect,
	HashSet,
	Layer,
	Option,
	Stream,
	Struct,
	SubscriptionRef,
	Tuple,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {Extractor} from '#services/bookings/lib/extraction.ts'
import {Places} from '#services/bookings/lib/places.ts'
import {byStart, diff, instantOf, upsert} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingsEvent, ExtractedItem, LocalTime} from '#services/bookings/schema.ts'
import {BookingList, BookingsError, Flight, Place, Stay, Train} from '#services/bookings/schema.ts'

function at(time: LocalTime, timeZone: string) {
	return Option.match(instantOf(time, timeZone), {
		onNone: () => BookingsError.make({message: `The time ${time} could not be read.`}),
		onSome: Effect.succeed
	})
}

export class Bookings extends Context.Service<
	Bookings,
	{
		readonly changes: Stream.Stream<BookingList>
		readonly events: Stream.Stream<BookingsEvent>
		readonly list: Effect.Effect<BookingList>
		readonly remove: (id: Booking['id']) => Effect.Effect<void, BookingsError>
		readonly restore: (booking: Booking) => Effect.Effect<void, BookingsError>
		readonly text: (text: string) => Effect.Effect<BookingList, BookingsError>
		readonly update: (id: Booking['id'], change: (booking: Booking) => Booking) => Effect.Effect<void, BookingsError>
	}
>()('@deslop/trips/services/bookings/service/Bookings') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const places = yield* Places
			const extractor = yield* Extractor
			const crypto = yield* Crypto.Crypto
			const kv = yield* KeyValueStore.KeyValueStore
			const failed = Effect.mapError((cause: unknown) =>
				BookingsError.make({cause, message: 'The trips storage failed.'})
			)
			const bookingsStore = KeyValueStore.toSchemaStore(kv, BookingList)

			const state = yield* SubscriptionRef.make<BookingList>(
				Option.getOrElse(yield* failed(bookingsStore.get('bookings')), Array.empty<Booking>)
			)

			// Persist before publishing, so a restart never loses a change the iPhone already showed.
			function transact<A>(change: (current: BookingList) => [A, BookingList]) {
				return Effect.uninterruptible(
					SubscriptionRef.modifyEffect(state, current => {
						const result = change(current)
						if (result[1] === current) return Effect.succeed(result)
						// Soonest first in memory as on disk, so a booking saved out of order lists in place.
						const sorted = Array.sort(result[1], byStart)
						return Effect.as(failed(bookingsStore.set('bookings', sorted)), Tuple.make(result[0], sorted))
					})
				)
			}

			const id = pipe(
				crypto.randomUUIDv4(),
				Effect.mapError(cause => BookingsError.make({cause, message: 'No booking id.'}))
			)

			// Saved with its zone; an unplaced station of an Italian operator falls back to Italy's, another railway's fails the save.
			const stationFor = Effect.fnUntraced(function* (name: string, operator: Train['operator']) {
				const found = yield* Effect.option(places.station(name))
				const timeZone = yield* Option.match(
					Option.orElse(
						Option.flatMap(found, place => Option.fromUndefinedOr(place.timeZone)),
						() => Option.liftPredicate('Europe/Rome', () => operator !== 'other')
					),
					{
						onNone: () => BookingsError.make({message: `The station ${name} could not be placed.`}),
						onSome: Effect.succeed
					}
				)
				return {...Option.getOrElse(found, () => Place.make({name})), timeZone}
			})

			// Airports and stations resolve from their datasets, so a time reads in the right zone and a ride has coordinates.
			const resolve = Effect.fnUntraced(function* (item: ExtractedItem) {
				const base = {
					createdAt: yield* Clock.currentTimeMillis,
					id: yield* id,
					sources: ['pasted'],
					status: item.status
				}
				if (item.kind === 'flight') {
					const from = yield* places.airport(item.from)
					const to = yield* places.airport(item.to)
					const zone = from.timeZone ?? 'UTC'
					return Flight.make({
						...base,
						...Struct.pick(item, ['seat', 'boardingGroup', 'confirmation']),
						...(yield* Option.match(Option.fromUndefinedOr(item.boarding), {
							onNone: () => Effect.succeed({}),
							onSome: boarding => Effect.map(at(boarding, zone), boardingAt => ({boardingAt}))
						})),
						airline: item.airlineName,
						airlineCode: item.airlineCode,
						arrives: yield* at(item.arrival, to.timeZone ?? 'UTC'),
						departs: yield* at(item.departure, zone),
						from,
						number: item.flightNumber,
						to
					})
				}
				if (item.kind === 'train') {
					const from = yield* stationFor(item.from, item.operator)
					const to = yield* stationFor(item.to, item.operator)
					return Train.make({
						...base,
						...Struct.pick(item, ['coach', 'seat', 'confirmation']),
						arrives: yield* at(item.arrival, to.timeZone),
						departs: yield* at(item.departure, from.timeZone),
						from,
						number: item.trainNumber,
						operator: item.operator,
						operatorName: item.operatorName,
						to
					})
				}
				return Stay.make({
					...base,
					...Struct.pick(item, ['confirmation']),
					checkIn: yield* at(item.checkIn, item.timeZone),
					checkOut: yield* at(item.checkOut, item.timeZone),
					name: item.name,
					place: {address: item.address, city: item.city, name: item.name, timeZone: item.timeZone}
				})
			})

			return Bookings.of({
				changes: SubscriptionRef.changes(state),
				events: pipe(
					SubscriptionRef.changes(state),
					Stream.mapAccum(
						() => Option.none<BookingList>(),
						(previous, current: BookingList) =>
							[
								Option.some(current),
								Option.match(previous, {
									onNone: () => Array.of<BookingsEvent>({removed: [], reset: true, upserted: current}),
									onSome: before => {
										const changes = diff(before, current)
										if (Array.isReadonlyArrayEmpty(changes.upserted) && Array.isReadonlyArrayEmpty(changes.removed)) {
											return []
										}
										return Array.of<BookingsEvent>({...changes, reset: false})
									}
								})
							] as const
					)
				),
				list: SubscriptionRef.get(state),
				remove: Effect.fn('Bookings.remove')(function* (bookingId) {
					yield* transact(current => {
						if (!Array.some(current, booking => booking.id === bookingId)) return Tuple.make(undefined, current)
						return Tuple.make(
							undefined,
							Array.filter(current, booking => booking.id !== bookingId)
						)
					})
				}),
				// An undone delete puts the booking back as it was, under its own id.
				restore: Effect.fn('Bookings.restore')(function* (booking) {
					yield* transact(current => {
						if (Array.some(current, found => found.id === booking.id)) return Tuple.make(undefined, current)
						return Tuple.make(undefined, [...current, booking])
					})
				}),
				text: Effect.fn('Bookings.text')(function* (text) {
					const items = yield* extractor.text(text)
					if (Array.isReadonlyArrayEmpty(items)) {
						return yield* BookingsError.make({message: 'No flight, train or stay in this text.'})
					}
					// Every segment or none, so a ticket is never half saved; the failure names the place to fix.
					const resolved = yield* Effect.forEach(items, item => Effect.result(resolve(item)), {concurrency: 1})
					const issues = Array.getFailures(resolved)
					if (Array.isReadonlyArrayNonEmpty(issues)) {
						return yield* BookingsError.make({
							message: Array.join(
								Array.map(issues, error => error.message),
								' '
							)
						})
					}
					const ids = yield* transact(current => {
						const result = upsert(current, Array.getSuccesses(resolved))
						if (Array.isReadonlyArrayEmpty(result.ids)) return Tuple.make(result.ids, current)
						return Tuple.make(result.ids, result.bookings)
					})
					const touched = HashSet.fromIterable(ids)
					return Array.filter(yield* SubscriptionRef.get(state), booking => HashSet.has(touched, booking.id))
				}),
				update: Effect.fn('Bookings.update')(function* (bookingId, change) {
					yield* transact(current =>
						Option.match(
							Array.findFirst(current, booking => booking.id === bookingId),
							{
								onNone: () => Tuple.make(undefined, current),
								onSome: before => {
									const after = change(before)
									if (after === before) return Tuple.make(undefined, current)
									return Tuple.make(
										undefined,
										Array.map(current, booking =>
											Boolean.match(booking === before, {onFalse: () => booking, onTrue: () => after})
										)
									)
								}
							}
						)
					)
				})
			})
		})
	)
}
