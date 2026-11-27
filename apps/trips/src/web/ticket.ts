import {HtmlFiles} from '@effect/ui/html'

import {Effect, Number, Option, Predicate, pipe} from 'effect'

import {FlightsError, IMAGE_BYTES, TicketSource} from '#contracts'

const bookingJpeg = Effect.fnUntraced(function* (file: File) {
	const image = yield* Effect.acquireRelease(
		Effect.tryPromise({
			catch: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
			try: () => createImageBitmap(file)
		}),
		bitmap => Effect.sync(() => bitmap.close())
	)
	const size = Number.min(1, 1800 / Number.max(image.width, image.height))
	const canvas = document.createElement('canvas')
	canvas.width = Number.max(1, Number.round(size * image.width, 0))
	canvas.height = Number.max(1, Number.round(size * image.height, 0))
	const context = canvas.getContext('2d')
	if (Predicate.isNull(context)) return yield* FlightsError.make({message: 'The image canvas is not available.'})
	context.fillStyle = '#fff'
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.drawImage(image, 0, 0, canvas.width, canvas.height)
	return yield* Effect.callback<Blob, FlightsError>(resume => {
		canvas.toBlob(
			blob => {
				if (blob === null) resume(Effect.fail(FlightsError.make({message: 'The booking image could not be read.'})))
				else resume(Effect.succeed(blob))
			},
			'image/jpeg',
			0.88
		)
	})
})

const ticketFromFile = Effect.fnUntraced(function* (file: File) {
	if (file.size === 0 || file.size > IMAGE_BYTES) {
		return yield* FlightsError.make({message: 'Choose an image or PDF up to 4 MB.'})
	}
	if (file.type === 'application/pdf') {
		const pdf = yield* Effect.mapError(HtmlFiles.readAsBytes(file), cause =>
			FlightsError.make({cause, message: 'The booking PDF could not be read.'})
		)
		return TicketSource.cases.pdf.make({pdf})
	}
	const image = yield* pipe(
		Effect.scoped(bookingJpeg(file)),
		Effect.flatMap(HtmlFiles.readAsBytes),
		Effect.mapError(cause => FlightsError.make({cause, message: 'The booking image could not be read.'}))
	)
	return yield* Effect.mapError(TicketSource.cases.image.makeEffect({image}), cause =>
		FlightsError.make({cause, message: 'The booking image is too large.'})
	)
})

export function readTicket(file: unknown) {
	if (!(file instanceof File)) return Effect.fail(FlightsError.make({message: 'Choose an image or PDF.'}))
	return Effect.map(ticketFromFile(file), Option.some)
}
