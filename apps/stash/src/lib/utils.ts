import {Array, Effect, HashSet, Option, Order, Schedule, Schema, Stream, String, pipe} from 'effect'

import {AtomRpc, Atom} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import {File, Paths} from 'expo-file-system'

import {pasteboard} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl, isYouTube} from '#services/notes/lib/utils.ts'
import type {Note, NotesEvent} from '#services/notes/schema.ts'
import {NoteItem, NotesError} from '#services/notes/schema.ts'
import {brands} from '@deslop/components-mobile/icons'
import {alert, downloadAtom, writeAtomically} from '@deslop/components-mobile/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: MobileRuntime.layer('@deslop/stash')
}) {}

// Kinds

export const kinds = [
	{brand: brands.tiktok, kind: 'tiktok', label: 'TikTok', symbol: 'play.rectangle'},
	{brand: brands.x, kind: 'x', label: 'X', symbol: 'xmark'},
	{brand: brands.youtube, kind: 'youtube', label: 'YouTube', symbol: 'play.tv'},
	{kind: 'web', label: 'Web', symbol: 'globe'},
	{kind: 'note', label: 'Notes', symbol: 'text.alignleft'},
	{kind: 'file', label: 'Photos and Videos', symbol: 'photo'}
] as const

export type Kind = (typeof kinds)[number]['kind']

export function brandOf(note: NoteItem) {
	if (note.source === 'TikTok') return Option.some(brands.tiktok)
	if (note.source === 'X') return Option.some(brands.x)
	return Option.as(Option.filter(Option.fromNullishOr(note.url), isYouTube), brands.youtube)
}

export function kindOf(note: NoteItem): Kind {
	if (note.file !== undefined) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	return Option.isSome(brandOf(note)) ? 'youtube' : 'web'
}

// Notes

const listFile = new File(Paths.document, 'list.json')

type ListJson = typeof ListJson.Type
const ListJson = Schema.fromJsonString(Schema.Array(NoteItem))

const newestFirst = Order.flip(Order.mapInput(Order.Number, (item: NoteItem) => item.createdAt))

function apply(items: NoteItem[], event: NotesEvent) {
	if (event.reset) return Array.sort(event.upserted, newestFirst)
	const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, item => item.id)])
	return Array.sort([...Array.filter(items, item => !HashSet.has(replaced, item.id)), ...event.upserted], newestFirst)
}

// The copy on the iPhone shows the list while the server is out of reach.
export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		get(MobileRuntime.activationsAtom)
		return Stream.concat(
			Stream.fromEffect(
				pipe(
					Effect.try(() => listFile.textSync()),
					Effect.flatMap(Schema.decodeEffect(ListJson)),
					Effect.orElseSucceed(Array.empty<NoteItem>)
				)
			),
			pipe(
				Effect.map(RpcClient, client => client('notes.watch', undefined)),
				Stream.unwrap,
				Stream.scan(Array.empty<NoteItem>, apply),
				Stream.drop(1),
				Stream.tap(items =>
					pipe(
						Schema.encodeEffect(ListJson)(items),
						Effect.flatMap(json => Effect.try(() => writeAtomically(listFile, json))),
						Effect.catch(error => Effect.logWarning('The list could not be kept on this iPhone', error))
					)
				),
				Stream.retry(Schedule.spaced('2 seconds'))
			)
		)
	})
)

// The list replaces an item when its note changes, so the new item loads the note again.
export const noteAtom = Atom.family((item: NoteItem) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('notes.get', {id: item.id})))
)

export const searchAtom = Atom.family((query: string) =>
	RpcClient.runtime.atom(
		String.isEmpty(query)
			? Effect.succeedNone
			: Effect.map(
					Effect.flatMap(RpcClient, client => client('notes.search', {query})),
					ids => Option.some(HashSet.fromIterable(ids))
				)
	)
)

export function imageAtom(id: Note['id']) {
	return downloadAtom({name: id, url: new URL(`/api/images/${id}`, MobileRuntime.server).href})
}

// Actions stay alive, so leaving the screen does not interrupt the request.

export const regenerateAtom = Atom.keepAlive(
	RpcClient.runtime.fn((id: Note['id']) =>
		pipe(
			Effect.flatMap(RpcClient, client => client('notes.regenerate', {id})),
			alert('Not Regenerated')
		)
	)
)

export const removeAtom = Atom.keepAlive(
	RpcClient.runtime.fn((id: Note['id']) =>
		pipe(
			Effect.flatMap(RpcClient, client => client('notes.remove', {id})),
			alert('Not Deleted')
		)
	)
)

function capture(text: string) {
	return Effect.flatMap(RpcClient, client => client('notes.capture', {id: Crypto.randomUUID(), text}))
}

const draftFile = new File(Paths.document, 'draft.txt')

export const draftAtom = Atom.writable(
	() => (draftFile.exists ? draftFile.textSync() : ''),
	(context, text: string) => {
		writeAtomically(draftFile, text)
		context.setSelf(text)
	}
)

export const writeAtom = Atom.keepAlive(
	RpcClient.runtime.fn(
		(text: string, get) =>
			pipe(
				capture(String.trim(text)),
				Effect.andThen(
					Effect.sync(() => {
						if (get(draftAtom) === text) get.set(draftAtom, '')
					})
				),
				alert('Note Not Saved')
			),
		{concurrent: true}
	)
)

// Clipboard

const clipboardFile = new File(Paths.document, 'clipboard.txt')

type Offer = {count: string; kind: 'image' | 'link'}

// Asking what the clipboard holds reads nothing, so iOS shows its paste banner only after Save.
export const offerAtom = Atom.keepAlive(
	Atom.make(get =>
		Effect.gen(function* () {
			get(MobileRuntime.activationsAtom)
			const count = `${pasteboard.changeCount()}`
			if (clipboardFile.exists && clipboardFile.textSync() === count) return Option.none<Offer>()
			if (yield* Effect.promise(() => Clipboard.hasImageAsync())) return Option.some<Offer>({count, kind: 'image'})
			if (yield* Effect.promise(() => pasteboard.hasLink())) return Option.some<Offer>({count, kind: 'link'})
			return Option.none<Offer>()
		})
	)
)

const saveImage = Effect.gen(function* () {
	const image = yield* Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The copied image could not be read.'}),
		try: () => Clipboard.getImageAsync({format: 'jpeg', jpegQuality: 0.85})
	})
	if (image === null) return yield* NotesError.make({message: 'The clipboard no longer holds an image.'})
	const id = Crypto.randomUUID()
	const file = new File(Paths.cache, `${id}.jpg`)
	const response = yield* pipe(
		Effect.tryPromise({
			catch: cause => NotesError.make({cause, message: 'The image could not be sent.'}),
			try: () => {
				file.writeSync(String.replace(/^data:[^,]*,/u, '')(image.data), {encoding: 'base64'})
				return file.upload(new URL(`/api/files/${id}`, MobileRuntime.server).href, {
					headers: {'content-type': 'image/jpeg'},
					httpMethod: 'POST'
				})
			}
		}),
		Effect.ensuring(Effect.sync(() => file.delete()))
	)
	if (response.status >= 300) {
		return yield* NotesError.make({message: `The server refused the image with status ${response.status}.`})
	}
})

const saveLink = Effect.gen(function* () {
	const text = String.trim(
		yield* Effect.tryPromise({
			catch: cause => NotesError.make({cause, message: 'The clipboard could not be read.'}),
			try: () => Clipboard.getStringAsync()
		})
	)
	// iOS detects a bare domain such as example.com/page as a link too.
	const link = captureUrl(text) === null && !String.includes(' ')(text) ? `https://${text}` : text
	if (captureUrl(link) === null) return yield* NotesError.make({message: 'The copied text holds no link.'})
	yield* capture(link)
})

export const answerAtom = Atom.keepAlive(
	RpcClient.runtime.fn((answer: Offer & {save: boolean}, get) =>
		pipe(
			Effect.gen(function* () {
				yield* Effect.try({
					catch: cause => NotesError.make({cause, message: 'The answer could not be kept on this iPhone.'}),
					try: () => writeAtomically(clipboardFile, answer.count)
				})
				get.refresh(offerAtom)
				if (answer.save) yield* answer.kind === 'image' ? saveImage : saveLink
			}),
			alert('Not Saved')
		)
	)
)
