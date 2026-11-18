import {Boolean, Effect, Function, Option, Predicate, String} from 'effect'

import {getStringAsync, hasImageAsync} from 'expo-clipboard'
import {randomUUID} from 'expo-crypto'

import {copiedImage, makeClipboard, readClipboard} from '@deslop/components-mobile/lib/clipboard'
import type {ClipboardKind} from '@deslop/components-mobile/lib/clipboard'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'

import {capture} from '#lib/notes.ts'
import {RpcClient, session} from '#lib/session.ts'
import {native} from '#modules/native/index.ts'
import {captureUrl} from '#services/notes/lib/utils.ts'
import {NotesError} from '#services/notes/schema.ts'

// The upload runs inside the copied file's scope, and an interruption cancels it before the file is removed.
const saveImage = Effect.fnUntraced(function* (count: string) {
	const file = yield* copiedImage(count, 20_000_000)
	const headers = yield* session.headers
	const response = yield* Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The image could not be sent.'}),
		try: signal =>
			file.upload(new URL(`/api/files/${randomUUID()}`, session.server).href, {
				headers: {...headers, 'content-type': 'image/jpeg'},
				httpMethod: 'POST',
				signal
			})
	})
	if (response.status >= 300) {
		return yield* NotesError.make({message: `The server refused the image with status ${response.status}.`})
	}
}, Effect.scoped)

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
	answered: Function.constTrue,
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
			onTrue: () => provideRuntimeOnce(get, session.runtime, saveImage(copy.count))
		})
})
