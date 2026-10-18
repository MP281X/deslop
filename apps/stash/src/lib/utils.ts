import {
	Array,
	Boolean,
	Effect,
	HashSet,
	Option,
	Order,
	Predicate,
	Record,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {AtomRpc, Atom} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import {File, Paths} from 'expo-file-system'

import {brands} from '@deslop/components-mobile/icons'
import {alert, downloadAtom, writeAtomically} from '@deslop/components-mobile/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'

import {pasteboard} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl, isYouTube} from '#services/notes/lib/utils.ts'
import type {Kind, Note, NotesEvent} from '#services/notes/schema.ts'
import {Brand, NoteItem, NotesError} from '#services/notes/schema.ts'

// Server

// The app's one App Group, where the share extension reads the server too; without the file, the build's server.
const sharedFolder = Array.head(Record.values(Paths.appleSharedContainers))
const serverFile = Option.map(sharedFolder, folder => new File(folder, 'server'))

// The previous release signed in and kept its token here.
pipe(
	sharedFolder,
	Option.map(folder => new File(folder, 'token')),
	Option.filter(token => token.exists),
	Option.map(token => token.delete())
)

const listFile = new File(Paths.document, 'list.json')

function savedServer() {
	return pipe(
		serverFile,
		Option.filter(file => file.exists),
		Option.map(file => file.textSync()),
		Option.filter(String.isNonEmpty),
		Option.getOrElse(() => MobileRuntime.extra.server)
	)
}

// Another server's list must not show while the new one is out of reach.
export const serverAtom = Atom.writable(savedServer, (context, server: string) => {
	if (server === savedServer()) return
	Option.map(serverFile, file => writeAtomically(file, server))
	if (listFile.exists) listFile.delete()
	context.setSelf(server)
})

const protocol = MobileRuntime.layer('@deslop/stash')

// Each server builds its own client, so choosing another reconnects.
class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: get => protocol(get(serverAtom))
}) {}

// An action reads the client once: an action atom built on the client reruns its last call when the server changes.
function withClient<A, E>(get: Atom.FnContext, effect: Effect.Effect<A, E, RpcClient>) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}

// Kinds

export const kinds = {
	file: {label: 'Photos and Videos', symbol: 'photo'},
	note: {label: 'Notes', symbol: 'text.alignleft'},
	tiktok: {label: 'TikTok', logo: brands.tiktok},
	web: {label: 'Web', symbol: 'globe'},
	x: {label: 'X', logo: brands.x},
	youtube: {label: 'YouTube', logo: brands.youtube}
} as const satisfies Record<Kind, unknown>

export function kindOf(note: NoteItem) {
	if (note.file !== undefined) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	if (Option.exists(Option.fromNullishOr(note.url), isYouTube)) return 'youtube'
	return 'web'
}

// The kind of a note whose app has a logo.
export function brandOf(note: NoteItem) {
	return Option.liftPredicate(kindOf(note), Schema.is(Brand))
}

// The app that opens the note's link, when it is not the browser.
export function appOf(note: NoteItem) {
	return Option.map(brandOf(note), brand => kinds[brand].label)
}

// Notes

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
						Effect.ignore({log: 'Warn', message: 'The list could not be kept on this iPhone'})
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

export const queryAtom = Atom.make('')

// One atom for every query, so the previous results stay on screen while the next ones load.
export const searchAtom = RpcClient.runtime.atom(get => {
	const query = String.trim(get(queryAtom))
	if (String.isEmpty(query)) return Effect.succeedNone
	return Effect.map(
		Effect.flatMap(RpcClient, client => client('notes.search', {query})),
		ids => Option.some(HashSet.fromIterable(ids))
	)
})

// The file name holds the server, since two servers can hold the same note id.
export const imageAtom = Atom.family((id: Note['id']) =>
	Atom.make(get => {
		const server = new URL(get(serverAtom))
		return get.result(downloadAtom({name: `${server.host}-${id}`, url: new URL(`/api/images/${id}`, server).href}))
	})
)

// Actions stay alive, so leaving the screen does not interrupt the request.

export const regenerateAtom = Atom.keepAlive(
	Atom.fn((id: Note['id'], get) =>
		pipe(
			withClient(
				get,
				Effect.flatMap(RpcClient, client => client('notes.regenerate', {id}))
			),
			alert('Not Regenerated')
		)
	)
)

export const removeAtom = Atom.keepAlive(
	Atom.fn((id: Note['id'], get) =>
		pipe(
			withClient(
				get,
				Effect.flatMap(RpcClient, client => client('notes.remove', {id}))
			),
			alert('Not Deleted')
		)
	)
)

function capture(text: string) {
	return Effect.flatMap(RpcClient, client => client('notes.capture', {id: Crypto.randomUUID(), text}))
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
				withClient(get, capture(String.trim(text))),
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

const saveImage = Effect.fnUntraced(function* (server: string) {
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
				return file.upload(new URL(`/api/files/${id}`, server).href, {
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
	const link = Boolean.match(Predicate.isUndefined(captureUrl(text)) && !String.includes(' ')(text), {
		onFalse: () => text,
		onTrue: () => `https://${text}`
	})
	if (Predicate.isUndefined(captureUrl(link))) {
		return yield* NotesError.make({message: 'The copied text holds no link.'})
	}
	yield* capture(link)
})

const saveAtom = Atom.keepAlive(
	Atom.fn((kind: Offer['kind'], get) =>
		pipe(withClient(get, {image: saveImage(get.registry.get(serverAtom)), link: saveLink}[kind]), alert('Not Saved'))
	)
)

export const answerAtom = Atom.keepAlive(
	Atom.fn((answer: Offer & {save: boolean}, get) =>
		pipe(
			Effect.try({
				catch: cause => NotesError.make({cause, message: 'The answer could not be kept on this iPhone.'}),
				try: () => writeAtomically(clipboardFile, answer.count)
			}),
			Effect.andThen(
				Effect.sync(() => {
					if (answer.save) get.set(saveAtom, answer.kind)
				})
			),
			Effect.as(answer.count),
			alert('Not Saved')
		)
	)
)
