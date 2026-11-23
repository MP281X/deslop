import {Array, Effect, Function, Option, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {Linking} from 'react-native'

import {alertFailure} from '@deslop/components-mobile/lib/alerts'

import type {Place} from '#services/bookings/schema.ts'
import {BookingsError} from '#services/bookings/schema.ts'

export function placeLine(place: Place) {
	return pipe(
		[place.name, Option.getOrElse(place.city, Function.constant(''))],
		Array.filter(String.isNonEmpty),
		Array.join(', ')
	)
}

// An airport's coordinates come from the airport list the server reads.
function coordinatesOf(place: Place) {
	return Option.all({latitude: place.latitude, longitude: place.longitude})
}

export const mapsAtom = Atom.fn((place: Place) =>
	pipe(
		Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'Maps could not be opened.'}),
			try: () =>
				Linking.openURL(
					Option.match(coordinatesOf(place), {
						onNone: () => `maps://?daddr=${encodeURIComponent(placeLine(place))}`,
						onSome: found => `maps://?daddr=${found.latitude},${found.longitude}&q=${encodeURIComponent(place.name)}`
					})
				)
		}),
		alertFailure('No Directions')
	)
)

export const uberAtom = Atom.fn((place: Place) =>
	pipe(
		coordinatesOf(place),
		Effect.fromOption,
		Effect.mapError(cause => BookingsError.make({cause, message: 'The place could not be found for Uber.'})),
		Effect.flatMap(found =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'Uber could not be opened.'}),
				try: () =>
					Linking.openURL(
						`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${found.latitude}&dropoff[longitude]=${found.longitude}&dropoff[nickname]=${encodeURIComponent(place.name)}&dropoff[formatted_address]=${encodeURIComponent(placeLine(place))}`
					)
			})
		),
		alertFailure('No Uber')
	)
)
