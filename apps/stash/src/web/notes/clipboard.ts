import {Array, Effect, Option, Predicate, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {HttpBody} from 'effect/http'
import type {HttpClient} from 'effect/http'
import type {AtomRegistry} from 'effect/reactivity'

import {NoteId, NotesError, captureUrl} from '#contracts'

import {StashNative, atDevice} from '#web/notes/native.ts'
import {capture} from '#web/notes/notes.ts'
import {installed} from '#web/notes/session.ts'

const linkFrom = Effect.fnUntraced(function* (copy: string) {
	const text = String.trim(copy)
	if (String.isEmpty(text)) return yield* NotesError.make({message: 'Copy a link or image first.'})
	if (Predicate.isNotUndefined(captureUrl(text))) return text
	if (
		Option.isSome(String.match(/^[^\s/]+\.[^\s/]+(?:\/\S*)?$/u)(text)) &&
		Predicate.isNotUndefined(captureUrl(`https://${text}`))
	) {
		return `https://${text}`
	}
	return yield* NotesError.make({message: 'The copied text holds no link.'})
})

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

const sendImage = Effect.fnUntraced(function* (client: HttpClient.HttpClient, image: Blob) {
	const jpegImage = yield* jpeg(image)
	if (jpegImage.size > 20_000_000) {
		return yield* NotesError.make({message: 'The copied image is larger than 20 MB.'})
	}
	const buffer = yield* atDevice('The copied image could not be read.', () => jpegImage.arrayBuffer())
	const response = yield* client.post(`/api/files/${NoteId.make(SecureRandom.uuidV4Unsafe())}`, {
		body: HttpBody.uint8Array(new Uint8Array(buffer), 'image/jpeg')
	})
	if (response.status >= 300) {
		return yield* NotesError.make({message: (yield* response.text) || 'The copied image could not be saved.'})
	}
})

export const paste = Effect.fnUntraced(function* (registry: AtomRegistry.AtomRegistry, client: HttpClient.HttpClient) {
	if (installed) {
		const copy = yield* atDevice('The clipboard could not be read.', () => StashNative.paste())
		yield* Option.match(Option.fromUndefinedOr(copy.image), {
			onNone: Effect.fnUntraced(function* () {
				yield* capture(registry, yield* linkFrom(copy.text ?? ''))
			}),
			onSome: Effect.fnUntraced(function* (encoded) {
				yield* atDevice('The copied image could not be saved.', () =>
					StashNative.saveImage({data: encoded, id: NoteId.make(SecureRandom.uuidV4Unsafe())})
				)
			})
		})
		return
	}
	const items = yield* atDevice('The clipboard could not be read.', () => navigator.clipboard.read())
	yield* pipe(
		items,
		Array.findFirst(item =>
			pipe(
				item.types,
				Array.findFirst(String.startsWith('image/')),
				Option.map(type => ({item, type}))
			)
		),
		Option.match({
			onNone: () =>
				pipe(
					items,
					Array.findFirst(item => Array.contains(item.types, 'text/plain')),
					Option.match({
						onNone: () => Effect.fail(NotesError.make({message: 'Copy a link or image first.'})),
						onSome: Effect.fnUntraced(function* (item) {
							const blob = yield* atDevice('The copied link could not be read.', () => item.getType('text/plain'))
							yield* capture(
								registry,
								yield* linkFrom(yield* atDevice('The copied link could not be read.', () => blob.text()))
							)
						})
					})
				),
			onSome: Effect.fnUntraced(function* (pair) {
				yield* sendImage(
					client,
					yield* atDevice('The copied image could not be read.', () => pair.item.getType(pair.type))
				)
			})
		})
	)
})
