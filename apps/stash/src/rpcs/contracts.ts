import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/shared/auth'

import {Capture, Note, NoteId, NoteItem, NotesError, NotesEvent} from '#services/notes/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('notes.events', {error: NotesError, stream: true, success: NotesEvent}),
	Rpc.make('notes.get', {error: NotesError, payload: Schema.Struct({id: NoteId}), success: Note.json}),
	Rpc.make('notes.search', {
		error: NotesError,
		payload: Schema.Struct({query: Schema.String}),
		stream: true,
		success: Schema.Array(NoteId)
	}),
	Rpc.make('notes.capture', {error: NotesError, payload: Capture, success: NoteItem.json}),
	Rpc.make('notes.regenerate', {error: NotesError, payload: Schema.Struct({id: NoteId})}),
	Rpc.make('notes.remove', {error: NotesError, payload: Schema.Struct({id: NoteId})})
).middleware(RpcAuth) {}
