import {Option, Schema} from 'effect'

import type {Place} from '#contracts'

export function directionsTo(place: Place) {
	const destination = Option.match(Option.all({latitude: place.latitude, longitude: place.longitude}), {
		onNone: () => place.name,
		onSome: coordinates => `${coordinates.latitude},${coordinates.longitude}`
	})
	return `https://maps.apple.com/?${new URLSearchParams({daddr: destination})}`
}

type Drop = typeof Drop.Type
const Drop = Schema.fromJsonString(
	Schema.Struct({addressLine1: Schema.String, latitude: Schema.Finite, longitude: Schema.Finite})
)

// Uber’s web ride link avoids the App Store on phones without the app.
export function rideTo(place: Place) {
	return Option.map(
		Option.all({latitude: place.latitude, longitude: place.longitude}),
		coordinates =>
			`https://m.uber.com/looking?${new URLSearchParams({'drop[0]': Schema.encodeSync(Drop)({addressLine1: place.name, ...coordinates})})}`
	)
}
