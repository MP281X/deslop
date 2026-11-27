import {Effect, Option, pipe} from 'effect'

import {File} from 'expo-file-system'

import {FlightsError, IMAGE_BYTES, TicketSource} from '#contracts'

export const chooseTicket = Effect.gen(function* () {
	const picked = yield* Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'The booking file could not be opened.'}),
		try: () => File.pickFileAsync({mimeTypes: ['image/*', 'application/pdf']})
	})
	if (picked.canceled) return Option.none<TicketSource>()
	const file = picked.result
	if (file.size === 0 || file.size > IMAGE_BYTES) {
		return yield* FlightsError.make({message: 'Choose an image or PDF up to 4 MB.'})
	}
	const bytes = yield* Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'The booking file could not be read.'}),
		try: () => file.bytes()
	})
	if (file.type === 'application/pdf') return Option.some(TicketSource.cases.pdf.make({pdf: bytes}))
	if (file.type !== 'image/jpeg') {
		return yield* FlightsError.make({message: 'Share the image from Files or Photos to add it to Trips.'})
	}
	return yield* pipe(
		TicketSource.cases.image.makeEffect({image: bytes}),
		Effect.map(Option.some),
		Effect.mapError(cause => FlightsError.make({cause, message: 'The booking image could not be read.'}))
	)
})
