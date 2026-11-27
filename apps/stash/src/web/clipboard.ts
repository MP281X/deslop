import {Array, Effect, Option, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {FetchHttpClient, HttpBody, HttpClient} from 'effect/http'

import {NoteId, NotesError} from '#contracts'

import {copiedLink} from '#screens/reads.ts'

/* oxlint-disable typescript/no-restricted-types -- Clipboard and canvas return browser Promises. */
function atDevice<A>(message: string, call: () => Promise<A>) {
	return Effect.tryPromise({catch: cause => NotesError.make({cause, message}), try: call})
}
/* oxlint-enable typescript/no-restricted-types */

const jpeg = Effect.fnUntraced(function* (image: Blob) {
	const bitmap = yield* Effect.acquireRelease(
		atDevice('The copied image could not be read.', () => createImageBitmap(image)),
		value => Effect.sync(() => value.close())
	)
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const ctx = canvas.getContext('2d', {alpha: false})
	if (ctx === null) return yield* NotesError.make({message: 'The copied image could not be read.'})
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(bitmap, 0, 0)
	return yield* Effect.callback<Blob, NotesError>(resume => {
		canvas.toBlob(
			blob => {
				if (blob === null) resume(Effect.fail(NotesError.make({message: 'The copied image could not be read.'})))
				else resume(Effect.succeed(blob))
			},
			'image/jpeg',
			0.9
		)
	})
}, Effect.scoped)

const sendImage = Effect.fnUntraced(function* (image: Blob) {
	const jpegImage = yield* jpeg(image)
	if (jpegImage.size > 20_000_000) {
		return yield* NotesError.make({message: 'The copied image is larger than 20 MB.'})
	}
	const buffer = yield* atDevice('The copied image could not be read.', () => jpegImage.arrayBuffer())
	const response = yield* HttpClient.post(`/api/files/${NoteId.make(SecureRandom.uuidV4Unsafe())}`, {
		body: HttpBody.uint8Array(new Uint8Array(buffer), 'image/jpeg')
	})
	if (response.status >= 300) {
		return yield* NotesError.make({message: (yield* response.text) || 'The copied image could not be saved.'})
	}
})

export const paste = pipe(
	Effect.gen(function* () {
		const items = yield* atDevice('The clipboard could not be read.', () => navigator.clipboard.read())
		const photo = pipe(
			items,
			Array.findFirst(item =>
				pipe(
					item.types,
					Array.findFirst(String.startsWith('image/')),
					Option.map(type => ({item, type}))
				)
			),
			Option.getOrUndefined
		)
		if (photo !== undefined) {
			const image = yield* atDevice('The copied image could not be read.', () => photo.item.getType(photo.type))
			yield* sendImage(image)
			return undefined
		}
		const copy = yield* atDevice('The copied link could not be read.', () => navigator.clipboard.readText())
		return yield* copiedLink(copy)
	}),
	Effect.catchTag('HttpClientError', cause =>
		NotesError.make({cause, message: 'The copied image could not be saved.'})
	),
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Browser clipboard upload uses the page transport.
	Effect.provide(FetchHttpClient.layer)
)
