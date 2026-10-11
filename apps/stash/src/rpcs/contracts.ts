import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Capture, Note, NoteId, NotesError, NotesEvent} from '#services/notes/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('notes.watch', {error: NotesError, stream: true, success: NotesEvent}),
	Rpc.make('notes.get', {error: NotesError, payload: Schema.Struct({id: NoteId}), success: Note}),
	Rpc.make('notes.search', {payload: Schema.Struct({query: Schema.String}), success: Schema.Array(NoteId)}),
	Rpc.make('notes.capture', {error: NotesError, payload: Capture, success: Note}),
	Rpc.make('notes.regenerate', {error: NotesError, payload: Schema.Struct({id: NoteId})}),
	Rpc.make('notes.remove', {error: NotesError, payload: Schema.Struct({id: NoteId})})
) {}
