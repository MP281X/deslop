import {Effect} from 'effect'

import {registerPlugin} from '@capacitor/core'

import {NotesError} from '#contracts'
import type {NoteId} from '#contracts'

/* oxlint-disable typescript/no-restricted-types -- Capacitor's bridge returns Promises. */
export const StashNative = registerPlugin<{
	image: (options: {path: string}) => Promise<{data: string; type: string}>
	paste: () => Promise<{image?: string; text?: string}>
	saveImage: (options: {data: string; id: NoteId}) => Promise<void>
	settleShares: () => Promise<{rejections: string[]}>
	share: (options: {text: string}) => Promise<void>
}>('StashNative')

export function atDevice<A>(message: string, call: () => Promise<A>) {
	return Effect.tryPromise({catch: cause => NotesError.make({cause, message}), try: call})
}
/* oxlint-enable typescript/no-restricted-types */
