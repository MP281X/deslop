import {Array, DateTime, Effect, Option, Order, Stream, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {NoteId, NotesError, RpcContracts, captureUrl} from '#contracts'
import type {NoteItem} from '#contracts'

const newestFirst = pipe(
	Order.mapInput(DateTime.Order, (item: NoteItem) => item.createdAt),
	Order.combine(Order.mapInput(Order.String, (item: NoteItem) => item.id)),
	Order.flip
)
const apply = listReducer(newestFirst, (note: NoteItem) => note.id)

export function makeReads(protocol: ReturnType<typeof layerSocketProtocol>) {
	class Rpc extends AtomRpc.Service<Rpc>()('@deslop/stash/RpcClient', {
		group: RpcContracts.middleware(RpcStream),
		protocol
	}) {}

	const notesAtom = Rpc.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(Effect.map(Rpc, call => call('notes.events', undefined))),
				Stream.scan(Array.empty<NoteItem>, apply),
				Stream.drop(1)
			),
			reconnectOnDrop
		)
	)

	// The stream replaces an item when it changes; the new item reads its body again.
	const bodyAtoms = Atom.family((item: NoteItem) =>
		Rpc.runtime.atom(Effect.flatMap(Rpc, call => call('notes.body', {id: item.id})))
	)
	const mediaAtoms = Atom.family((item: NoteItem) =>
		Rpc.runtime.atom(Effect.flatMap(Rpc, call => call('notes.media', {id: item.id})))
	)

	function write<A, E>(registry: AtomRegistry.AtomRegistry, effect: Effect.Effect<A, E, Rpc>) {
		return pipe(
			registry,
			AtomRegistry.getResult(Rpc.runtime),
			Effect.flatMap(context => writeOutcome(Effect.provideContext(effect, context)))
		)
	}

	return {
		bodyAtoms,
		capture: (registry: AtomRegistry.AtomRegistry, text: string) =>
			write(
				registry,
				Effect.flatMap(Rpc, call => call('notes.capture', {id: NoteId.make(SecureRandom.uuidV4Unsafe()), text}))
			),
		mediaAtoms,
		notesAtom,
		reconnect(registry: AtomRegistry.AtomRegistry) {
			registry.refresh(Rpc.runtime)
		},
		regenerate: (registry: AtomRegistry.AtomRegistry, id: NoteId) =>
			write(
				registry,
				Effect.flatMap(Rpc, call => call('notes.regenerate', {id}))
			)
	}
}

export const copiedLink = Effect.fnUntraced(function* (copy: string) {
	const text = String.trim(copy)
	if (String.isEmpty(text)) return yield* NotesError.make({message: 'Copy a link or image first.'})
	if (captureUrl(text) !== undefined) return text
	if (
		Option.isSome(String.match(/^[^\s/]+\.[^\s/]+(?:\/\S*)?$/u)(text)) &&
		captureUrl(`https://${text}`) !== undefined
	) {
		return `https://${text}`
	}
	return yield* NotesError.make({message: 'The copied text holds no link.'})
})
