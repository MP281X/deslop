import {Array, Effect, Function, Option, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {Linking} from 'react-native'

import {alertFailure} from '@deslop/components-mobile/lib/alerts'

import type {Place} from '#services/flights/schema.ts'
import {FlightsError} from '#services/flights/schema.ts'

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

// Directions to the airport in Maps, from the flight or a Leave now notification.
export function directionsTo(place: Place) {
	return Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'Maps could not be opened.'}),
		try: () =>
			Linking.openURL(
				Option.match(coordinatesOf(place), {
					onNone: () => `maps://?daddr=${encodeURIComponent(placeLine(place))}`,
					onSome: found => `maps://?daddr=${found.latitude},${found.longitude}&q=${encodeURIComponent(place.name)}`
				})
			)
	})
}

export const mapsAtom = Atom.fn((place: Place) => alertFailure('No Directions')(directionsTo(place)))

// An Uber to the airport, from the flight or a Leave now notification.
export function rideTo(place: Place) {
	return pipe(
		coordinatesOf(place),
		Effect.fromOption,
		Effect.mapError(cause => FlightsError.make({cause, message: 'The place could not be found for Uber.'})),
		Effect.flatMap(found =>
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'Uber could not be opened.'}),
				try: () =>
					Linking.openURL(
						`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${found.latitude}&dropoff[longitude]=${found.longitude}&dropoff[nickname]=${encodeURIComponent(place.name)}&dropoff[formatted_address]=${encodeURIComponent(placeLine(place))}`
					)
			})
		)
	)
}

export const uberAtom = Atom.fn((place: Place) => alertFailure('No Uber')(rideTo(place)))
