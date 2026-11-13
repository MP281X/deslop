import {Array, Boolean, Effect, HashSet, Option, Order, Stream, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {randomUUID} from 'expo-crypto'
import {Directory, File, Paths} from 'expo-file-system'

import {makeRemoval} from '@deslop/components-mobile/removal'
import {alertFailure, cachedList, writeAtomically} from '@deslop/components-mobile/utils'
import {keepValueThroughOutages, liveStream} from '@deslop/runtime/client/live-stream'
import {activationsAtom} from '@deslop/runtime/mobile/activations'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {listReducer} from '@deslop/runtime/shared/list'

import {RpcClient, SERVER, session} from '#lib/session.ts'
import type {Note} from '#services/notes/schema.ts'
import {NoteItem, NotesError} from '#services/notes/schema.ts'

const listFile = new File(Paths.document, 'list.json')

const newestFirst = Order.flip(Order.mapInput(Order.Number, (item: NoteItem) => item.createdAt))

const apply = listReducer(newestFirst)

// The copy on the iPhone shows the list while the server is out of reach.
export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.never
		return cachedList(
			get,
			listFile,
			NoteItem,
			pipe(liveStream(RpcClient, 'notes.events'), Stream.scan(Array.empty<NoteItem>, apply), Stream.drop(1)),
			session.reconnectOrSignOut
		)
	})
)

// The list replaces an item when its note changes, so the new item loads the note again.
export const noteAtom = Atom.family((item: NoteItem) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('notes.get', {id: item.id})))
)

export const queryAtom = Atom.make('')

export const searchAtom = RpcClient.runtime.atom(get => {
	const query = String.trim(get(queryAtom))
	if (!session.signedIn(get) || String.isEmpty(query)) return Stream.succeed(Option.none())
	return keepValueThroughOutages(
		get,
		pipe(
			Effect.sleep('250 millis'),
			Effect.as(liveStream(RpcClient, 'notes.search', {query})),
			Stream.unwrap,
			Stream.map(ids => Option.some(HashSet.fromIterable(ids)))
		),
		session.reconnectOrSignOut
	)
})

const images = new Directory(Paths.cache, 'downloads')

// SwiftUI images read local files, so each preview is downloaded into the cache.
export const imageAtom = Atom.family((id: Note['id']) =>
	session.runtime.atom(get => {
		get(activationsAtom)
		return Effect.gen(function* () {
			const file = new File(images, id)
			if (file.exists) return file.uri
			images.create({idempotent: true, intermediates: true})
			const token = yield* session.bearer
			const downloaded = yield* Effect.tryPromise({
				catch: cause => NotesError.make({cause, message: 'The note image could not be downloaded.'}),
				try: () =>
					File.downloadFileAsync(new URL(`/api/images/${id}`, SERVER).href, file, {
						headers: {authorization: `Bearer ${token}`}
					})
			})
			return downloaded.uri
		})
	})
)

// Actions stay alive, so leaving the screen does not interrupt the request.

export const regenerateAtom = Atom.keepAlive(
	Atom.fn((id: Note['id'], get) =>
		pipe(
			provideRuntimeOnce(
				get,
				RpcClient.runtime,
				Effect.flatMap(RpcClient, client => client('notes.regenerate', {id}))
			),
			alertFailure('Not Regenerated')
		)
	)
)

export const removal = makeRemoval({
	notRemoved: 'Not Deleted',
	remove: (id, get) =>
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('notes.remove', {id}))
		)
})

export function capture(text: string) {
	return Effect.flatMap(RpcClient, client => client('notes.capture', {id: randomUUID(), text}))
}

const draftFile = new File(Paths.document, 'draft.txt')

export const draftAtom = Atom.writable(
	() => Boolean.match(draftFile.exists, {onFalse: () => '', onTrue: () => draftFile.textSync()}),
	(context, text: string) => {
		writeAtomically(draftFile, text)
		context.setSelf(text)
	}
)

export const writeAtom = Atom.keepAlive(
	Atom.fn(
		(text: string, get) =>
			pipe(
				provideRuntimeOnce(get, RpcClient.runtime, capture(String.trim(text))),
				Effect.andThen(
					Effect.sync(() => {
						if (get(draftAtom) === text) get.set(draftAtom, '')
					})
				),
				alertFailure('Note Not Saved')
			),
		{concurrent: true}
	)
)
