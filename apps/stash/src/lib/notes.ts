import {Array, DateTime, Effect, Order, Stream, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Atom, AtomRegistry} from 'effect/reactivity'

import {keepValueThroughOutages, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import {listReducer} from '@deslop/runtime/shared/list'

import {RpcClient} from '#lib/session.ts'
import {NoteId} from '#services/notes/schema.ts'
import type {NoteItem} from '#services/notes/schema.ts'

const newestFirst = pipe(
	Order.mapInput(DateTime.Order, (item: NoteItem) => item.createdAt),
	Order.combine(Order.mapInput(Order.String, (item: NoteItem) => item.id)),
	Order.flip
)
const apply = listReducer(newestFirst, note => note.id)

export const notesAtom = RpcClient.runtime.atom(get =>
	keepValueThroughOutages(
		get,
		pipe(liveStream(RpcClient, 'notes.events'), Stream.scan(Array.empty<NoteItem>, apply), Stream.drop(1)),
		reconnectOnDrop
	)
)

// The list replaces an item when it changes; the new item reads the body again.
export const noteAtom = Atom.family((item: NoteItem) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, call => call('notes.body', {id: item.id})))
)

export const mediaAtom = Atom.family((id: NoteId) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, call => call('notes.media', {id})))
)

function write<A, E>(registry: AtomRegistry.AtomRegistry, effect: Effect.Effect<A, E, RpcClient>) {
	return pipe(
		registry,
		AtomRegistry.getResult(RpcClient.runtime),
		Effect.flatMap(context => writeOutcome(Effect.provideContext(effect, context)))
	)
}

export function capture(registry: AtomRegistry.AtomRegistry, text: string) {
	return write(
		registry,
		Effect.flatMap(RpcClient, call => call('notes.capture', {id: NoteId.make(SecureRandom.uuidV4Unsafe()), text}))
	)
}

export function regenerate(registry: AtomRegistry.AtomRegistry, id: NoteId) {
	return write(
		registry,
		Effect.flatMap(RpcClient, call => call('notes.regenerate', {id}))
	)
}
