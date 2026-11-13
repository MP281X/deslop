import {Array, Effect, Option, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {geocodeAsync} from 'expo-location'
import {Linking} from 'react-native'

import {alertFailure} from '@deslop/components-mobile/utils'

import {departureOf, MINUTE, stayAfter} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Place} from '#services/bookings/schema.ts'
import {BookingsError} from '#services/bookings/schema.ts'

export function placeLine(place: Place) {
	return pipe([place.name, place.address ?? place.city ?? ''], pipelineSubject520 => Array.filter(pipelineSubject520, String.isNonEmpty), Array.join(', '))
}

type Coordinates = {latitude: number; longitude: number}

const coordinatesOf = Effect.fnUntraced(function* (place: Place) {
	if (place.latitude !== undefined && place.longitude !== undefined) {
		return Option.some<Coordinates>({latitude: place.latitude, longitude: place.longitude})
	}
	return Option.map(
		Array.head(
			yield* Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: `${place.name} could not be found on the map.`}),
				try: () => geocodeAsync(placeLine(place))
			})
		),
		match => ({latitude: match.latitude, longitude: match.longitude}) satisfies Coordinates
	)
})

export type Ride = {label: string; place: Place}

export function ridesFor(booking: Booking, bookings: BookingList, now: number) {
	if (booking._tag === 'stay') return [{label: booking.name, place: booking.place}] satisfies Ride[]
	const stay = Option.map(
		stayAfter(bookings, booking),
		found => ({label: found.name, place: found.place}) satisfies Ride
	)
	return pipe(stay, Option.filter(() => now > departureOf(booking) - 30 * MINUTE), pipelineSubject1591 => Option.match(pipelineSubject1591, {
			onNone: () => [{label: booking.from.name, place: booking.from}, ...Option.toArray(stay)] satisfies Ride[],
			onSome: next => [next] satisfies Ride[]
		}))
}

export const mapsAtom = Atom.fn((ride: Ride) =>
	pipe(
		coordinatesOf(ride.place),
		Effect.flatMap(coordinates =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'Maps could not be opened.'}),
				try: () =>
					Linking.openURL(
						Option.match(coordinates, {
							onNone: () => `maps://?daddr=${encodeURIComponent(placeLine(ride.place))}`,
							onSome: found => `maps://?daddr=${found.latitude},${found.longitude}&q=${encodeURIComponent(ride.label)}`
						})
					)
			})
		),
		alertFailure('No Directions')
	)
)

export const uberAtom = Atom.fn((ride: Ride) =>
	pipe(
		coordinatesOf(ride.place),
		Effect.flatMap(coordinates =>
			Effect.mapError(Effect.fromOption(coordinates), cause =>
				BookingsError.make({cause, message: 'The place could not be found for Uber.'})
			)
		),
		Effect.flatMap(found =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'Uber could not be opened.'}),
				try: () =>
					Linking.openURL(
						`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${found.latitude}&dropoff[longitude]=${found.longitude}&dropoff[nickname]=${encodeURIComponent(ride.label)}&dropoff[formatted_address]=${encodeURIComponent(placeLine(ride.place))}`
					)
			})
		),
		alertFailure('No Uber')
	)
)
