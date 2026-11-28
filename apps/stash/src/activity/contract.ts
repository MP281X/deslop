import {Function, Option, Schema, String} from 'effect'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import type {Note, NoteItem} from '#notes/contract.ts'

export type ActivityTarget = typeof ActivityTarget.Type
export const ActivityTarget = Schema.Struct({
	bundle: Schema.Literals(['xyz.mp281x.stash', 'xyz.mp281x.stash.dev']),
	token: Schema.RedactedFromValue(ApnsToken)
})

export type ActivityEvent = typeof ActivityEvent.Type
export const ActivityEvent = Schema.Literals(['start', 'update', 'end'])

export function saveState(note: Note | NoteItem) {
	return {
		noteId: note.id,
		source: Option.match(note.url, {onNone: Function.constant(''), onSome: url => new URL(url).hostname}),
		status: note.status,
		summary: String.slice(0, 400)(note.summary),
		title: String.slice(0, 120)(note.title)
	}
}

export type SaveState = ReturnType<typeof saveState> & {readonly elapsed?: number; readonly total?: number}
