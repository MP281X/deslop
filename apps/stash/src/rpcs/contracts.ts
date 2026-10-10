import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Capture, Note, NoteId, NotesError, NotesState} from '#services/notes/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('notes.watch', {error: NotesError, stream: true, success: NotesState}),
	Rpc.make('notes.capture', {error: NotesError, payload: Capture, success: Note}),
	Rpc.make('notes.remove', {error: NotesError, payload: Schema.Struct({id: NoteId})})
) {}
