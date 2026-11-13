import {Boolean, Effect, Option, Predicate, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {getImageAsync, getStringAsync, hasImageAsync} from 'expo-clipboard'
import {randomUUID} from 'expo-crypto'
import {File, Paths} from 'expo-file-system'

import {makeClipboard, readClipboard} from '@deslop/components-mobile/clipboard'
import type {ClipboardKind} from '@deslop/components-mobile/clipboard'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'

import {capture} from '#lib/notes.ts'
import {RpcClient, SERVER, session} from '#lib/session.ts'
import {native} from '#modules/native/index.ts'
import {captureUrl} from '#services/notes/lib/utils.ts'
import {NotesError} from '#services/notes/schema.ts'

const saveImage = Effect.fnUntraced(function* (count: string) {
	const image = yield* readClipboard(
		count,
		Effect.tryPromise({
			catch: cause => NotesError.make({cause, message: 'The copied image could not be read.'}),
			try: () => getImageAsync({format: 'jpeg', jpegQuality: 0.85})
		})
	)
	if (image === null) return yield* NotesError.make({message: 'The clipboard no longer holds an image.'})
	const token = yield* session.bearer
	const id = randomUUID()
	const file = new File(Paths.cache, `${id}.jpg`)
	const response = yield* pipe(
		Effect.tryPromise({
			catch: cause => NotesError.make({cause, message: 'The image could not be sent.'}),
			try: () => {
				file.writeSync(String.replace(/^data:[^,]*,/u, '')(image.data), {encoding: 'base64'})
				return file.upload(new URL(`/api/files/${id}`, SERVER).href, {
					headers: {authorization: `Bearer ${token}`, 'content-type': 'image/jpeg'},
					httpMethod: 'POST'
				})
			}
		}),
		Effect.ensuring(Effect.sync(() => file.delete()))
	)
	if (response.status >= 300) {
		return yield* NotesError.make({message: `The server refused the image with status ${response.status}.`})
	}
})

const saveLink = Effect.fnUntraced(function* (count: string) {
	const text = String.trim(
		yield* readClipboard(
			count,
			Effect.tryPromise({
				catch: cause => NotesError.make({cause, message: 'The clipboard could not be read.'}),
				try: () => getStringAsync()
			})
		)
	)
	// iOS detects a bare domain such as example.com/page as a link too.
	const link = Boolean.match(Predicate.isUndefined(captureUrl(text)) && !String.includes(' ')(text), {
		onFalse: () => text,
		onTrue: () => `https://${text}`
	})
	if (Predicate.isUndefined(captureUrl(link))) {
		return yield* NotesError.make({message: 'The copied text holds no link.'})
	}
	yield* capture(link)
})

export const clipboard = makeClipboard({
	// A copy that failed to save is never offered again.
	answered: () => true,
	detect: Effect.gen(function* () {
		if (yield* Effect.promise(() => hasImageAsync())) return Option.some<ClipboardKind>('image')
		if (yield* Effect.promise(() => native.hasLink())) return Option.some<ClipboardKind>('link')
		return Option.none<ClipboardKind>()
	}),
	labels: {
		confirm: 'Save',
		notSaved: 'Not Saved',
		questions: {image: 'Save the copied image?', link: 'Save the copied link?', text: 'Save the copied link?'}
	},
	save: (copy, get) =>
		Boolean.match(copy.kind === 'image', {
			onFalse: () => provideRuntimeOnce(get, RpcClient.runtime, saveLink(copy.count)),
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The RPC runtime exposes only its client, so the upload brings its own fetch.
			onTrue: () => Effect.provide(saveImage(copy.count), FetchHttpClient.layer)
		})
})
