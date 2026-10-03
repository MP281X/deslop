import {Array, Effect, Schedule, Stream, String, pipe} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'
import {RpcSerialization} from 'effect/rpc'
import type {RpcClientError} from 'effect/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {NotesError, NotesState} from '#services/notes/schema.ts'
import * as ClientRuntime from '@deslop/runtime/client'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/notes/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: ClientRuntime.layer('@deslop/notes', RpcSerialization.layerJson)
}) {}

export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		pipe(
			RpcClient,
			Effect.map(client => client('notes.watch', undefined)),
			Stream.unwrap,
			Stream.tapCause(cause =>
				Effect.sync(() =>
					get.setSelf(
						AsyncResult.failureWithPrevious(cause, {
							previous:
								get.self<
									AsyncResult.AsyncResult<
										NotesState,
										NotesError | RpcClientError.RpcClientError | Cause.NoSuchElementError
									>
								>()
						})
					)
				)
			),
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(meta => meta.input._tag === 'RpcClientError' && meta.input.reason._tag !== 'RpcClientDefect')
				)
			)
		)
	)
)

export function findNotes(notes: NotesState['notes'], filters: {query: string; tag: string}) {
	const words = pipe(filters.query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	return Array.filter(notes, note => {
		if (String.isNonEmpty(filters.tag) && !Array.contains(note.tags, filters.tag)) return false
		const text = pipe(
			[note.title, note.summary, note.content, note.raw, note.url ?? '', ...note.tags],
			Array.join(' '),
			String.toLowerCase
		)
		return Array.every(words, word => pipe(text, String.includes(word)))
	})
}

export function parseTags(text: string) {
	return pipe(text, String.split(','), Array.map(String.trim), Array.filter(String.isNonEmpty), Array.dedupe)
}
