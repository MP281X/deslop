import {Array, Boolean, DateTime, Effect, Function, HashSet, Option, Order, Stream, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {randomUUID} from 'expo-crypto'
import {Directory, File, Paths} from 'expo-file-system'

import {alertFailure} from '@deslop/components-mobile/lib/alerts'
import {cachedList, writeAtomically} from '@deslop/components-mobile/lib/files'
import {makeRemoval} from '@deslop/components-mobile/lib/removal'
import {keepValueThroughOutages, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {activationsAtom} from '@deslop/runtime/mobile/activations'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {listReducer} from '@deslop/runtime/shared/list'

import {RpcClient, session} from '#lib/session.ts'
import type {Note} from '#services/notes/schema.ts'
import {NoteId, NoteItem, NotesError} from '#services/notes/schema.ts'

const listFile = new File(Paths.document, 'list.json')

// The server's order, newest first and then by id, so notes saved in the same millisecond keep their place.
const newestFirst = pipe(
	Order.mapInput(DateTime.Order, (item: NoteItem) => item.createdAt),
	Order.combine(Order.mapInput(Order.String, (item: NoteItem) => item.id)),
	Order.flip
)

const apply = listReducer(newestFirst, note => note.id)

// The copy on the iPhone shows the list while the server is out of reach.
export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		cachedList(
			get,
			session,
			listFile,
			NoteItem.json,
			pipe(liveStream(RpcClient, 'notes.events'), Stream.scan(Array.empty<NoteItem>, apply), Stream.drop(1)),
			reconnectOnDrop
		)
	)
)

// The list replaces an item when its note changes, so the new item loads the note again.
export const noteAtom = Atom.family((item: NoteItem) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('notes.body', {id: item.id})))
)

// How many pictures the note's post shows, asked of the server each time the note opens.
export const mediaAtom = Atom.family((id: NoteId) =>
	RpcClient.runtime.atom(
		Effect.flatMap(RpcClient, client =>
			Effect.catchTag(client('notes.media', {id}), 'NotesError', error =>
				Effect.as(Effect.logWarning('The post pictures could not be counted', error), 0)
			)
		)
	)
)

export const queryAtom = Atom.make('')

// One reader per trimmed query, so the ids it keeps through an outage are always that query's own.
export const searchAtom = Atom.family((query: string) =>
	RpcClient.runtime.atom(get => {
		if (Option.isNone(session.admitted(get)) || String.isEmpty(query)) return Stream.succeed(Option.none())
		return keepValueThroughOutages(
			get,
			pipe(
				Effect.sleep('250 millis'),
				Effect.as(liveStream(RpcClient, 'notes.search', {query})),
				Stream.unwrap,
				Stream.map(ids => Option.some(HashSet.fromIterable(ids)))
			),
			reconnectOnDrop
		)
	})
)

const images = new Directory(Paths.cache, 'downloads')

// A post's pictures can change order at their source, so each launch keeps its own copies and drops those of the launches before it; a note's cover never changes.
const pictures = new Directory(Paths.cache, `pictures-${randomUUID()}`)

const dropOlderPictures = Effect.ignore(
	Effect.try({
		catch: cause => NotesError.make({cause, message: 'Older post pictures could not be removed from this iPhone.'}),
		try: () => {
			if (pictures.exists) return
			Array.forEach(new Directory(Paths.cache).list(), entry => {
				if (entry instanceof Directory && String.startsWith('pictures-')(entry.name)) entry.delete()
			})
		}
	}),
	{log: 'Warn', message: 'Older post pictures stay in the cache'}
)

// SwiftUI images read local files, so each picture is downloaded into the cache.
const download = Effect.fnUntraced(function* (folder: Directory, name: string, route: string) {
	const file = new File(folder, name)
	if (file.exists) return file.uri
	folder.create({idempotent: true, intermediates: true})
	const headers = yield* session.headers
	const downloaded = yield* Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The note image could not be downloaded.'}),
		try: () => File.downloadFileAsync(new URL(route, session.server).href, file, {headers})
	})
	return downloaded.uri
})

export const imageAtom = Atom.family((id: Note['id']) =>
	session.runtime.atom(get => {
		get(activationsAtom)
		return download(images, id, `/api/images/${id}`)
	})
)

// A picture of the post, from the server's `/api/notes/<path>`.
export const mediaImageAtom = Atom.family((path: string) =>
	session.runtime.atom(get => {
		get(activationsAtom)
		return Effect.andThen(
			dropOlderPictures,
			download(pictures, String.replaceAll('/', '-')(path), `/api/notes/${path}`)
		)
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
	remove: (id: NoteId, get) =>
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('notes.remove', {id}))
		)
})

export function capture(text: string) {
	return Effect.flatMap(RpcClient, client => client('notes.capture', {id: NoteId.make(randomUUID()), text}))
}

const draftFile = new File(Paths.document, 'draft.txt')

export const draftAtom = Atom.writable(
	() => Boolean.match(draftFile.exists, {onFalse: Function.constant(''), onTrue: () => draftFile.textSync()}),
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
