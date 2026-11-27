import {Boolean, Effect, Number, Option, pipe} from 'effect'

import {File} from 'expo-file-system'
import {ImageManipulator, SaveFormat} from 'expo-image-manipulator'
import type {ImageRef} from 'expo-image-manipulator'

import {FlightsError, IMAGE_BYTES, TicketSource} from '#contracts'

function readImage<A>(run: () => PromiseLike<A>) {
	return Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
		try: run
	})
}

// Match the web picker: at most 1800 px on the long side.
function fitted(source: ImageRef) {
	if (Number.max(source.width, source.height) <= 1800) return Effect.succeed(source)
	const size = Boolean.match(source.width >= source.height, {
		onFalse: () => ({height: 1800}),
		onTrue: () => ({width: 1800})
	})
	return readImage(() => ImageManipulator.manipulate(source).resize(size).renderAsync())
}

const bookingJpeg = Effect.fnUntraced(function* (file: File) {
	const image = yield* fitted(yield* readImage(() => ImageManipulator.manipulate(file.uri).renderAsync()))
	const jpeg = yield* readImage(() => image.saveAsync({compress: 0.88, format: SaveFormat.JPEG}))
	return yield* readImage(() => new File(jpeg.uri).bytes())
})

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
	if (file.type === 'application/pdf') {
		const pdf = yield* Effect.tryPromise({
			catch: cause => FlightsError.make({cause, message: 'The booking PDF could not be read.'}),
			try: () => file.bytes()
		})
		return Option.some(TicketSource.cases.pdf.make({pdf}))
	}
	return yield* pipe(
		bookingJpeg(file),
		Effect.flatMap(image => TicketSource.cases.image.makeEffect({image})),
		Effect.mapBoth({
			onFailure: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
			onSuccess: Option.some
		})
	)
})
