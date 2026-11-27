import {Effect} from 'effect'

import {requireNativeModule} from 'expo-modules-core'

import {NotesError} from '#contracts'
import type {NoteId} from '#contracts'

// oxlint-disable typescript/no-restricted-types -- Expo turns each native AsyncFunction into a Promise.
export const StashNative = requireNativeModule<{
	image: (path: string) => Promise<{data: string; type: string}>
	paste: () => Promise<{image?: string; text?: string}>
	readDraft: () => string
	readSession: () => string | null
	saveImage: (id: NoteId, data: string) => Promise<void>
	settleShares: () => Promise<readonly string[]>
	writeDraft: (text: string) => void
	writeSession: (secret?: string) => void
}>('StashNative')

export function atDevice<A>(message: string, call: () => Promise<A>) {
	// Effect passes a signal; Expo's native functions check the exact argument count.
	return Effect.tryPromise({catch: cause => NotesError.make({cause, message}), try: () => call()})
}
// oxlint-enable typescript/no-restricted-types
