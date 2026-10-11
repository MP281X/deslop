import {
	Array,
	Clock,
	Effect,
	HashSet,
	Layer,
	MutableHashSet,
	Option,
	Order,
	Result,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {AtomRpc, Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import {Asset} from 'expo-asset'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import {Directory, File, Paths, UploadTask, UploadType} from 'expo-file-system'
import * as Haptics from 'expo-haptics'
import * as Updates from 'expo-updates'
import {Alert, AppState} from 'react-native'

import {Outbox, Pending, deliver} from '#lib/outbox.ts'
import {pasteboard} from '#modules/pasteboard/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl} from '#services/notes/lib/utils.ts'
import type {FileType, Note, NotesEvent} from '#services/notes/schema.ts'
import {AiSpend, NoteItem, NotesError} from '#services/notes/schema.ts'

// app.config.ts writes these for each build variant.
const settings = Schema.decodeUnknownSync(Schema.Struct({appGroup: Schema.String, server: Schema.String}))(
	Constants.expoConfig?.extra
)

const cacheFile = new File(Paths.document, 'list.json')
const imagesDirectory = new Directory(Paths.cache, 'images')

type PendingFile = typeof PendingFile.Type
const PendingFile = Schema.fromJsonString(Pending)

// The list as the app holds it: each note's list fields, newest first, and the month's AI spend.
export type NotesView = typeof NotesView.Type
const NotesView = Schema.Struct({aiSpend: AiSpend, items: Schema.Array(NoteItem)})

type CacheFile = typeof CacheFile.Type
const CacheFile = Schema.fromJsonString(NotesView)

function storageFailed(message: string) {
	return (cause: unknown) => NotesError.make({cause, message})
}

// Writes a sibling file and moves it into place, so a killed app never leaves half a file behind.
function replace(file: File, text: string) {
	const temporary = new File(`${file.uri}.tmp`)
	temporary.writeSync(text)
	temporary.moveSync(file, {overwrite: true})
}

// The App Group container is shared with the share extension, which leaves captures it could not send in pending/.
const pendingDirectory = pipe(
	Effect.fromOption(Option.fromNullishOr(Paths.appleSharedContainers[settings.appGroup])),
	Effect.map(container => new Directory(container, 'pending')),
	Effect.mapError(storageFailed('This build has no App Group, so captures cannot be kept.'))
)

const outbox = Outbox.of({
	add: Effect.fnUntraced(function* (pending: Pending) {
		const directory = yield* pendingDirectory
		const json = yield* pipe(
			Schema.encodeEffect(PendingFile)(pending),
			Effect.mapError(storageFailed('The capture could not be kept on this iPhone.'))
		)
		yield* Effect.try({
			catch: storageFailed('The capture could not be kept on this iPhone.'),
			try: () => {
				directory.create({idempotent: true, intermediates: true})
				replace(new File(directory, `${pending.id}.json`), json)
			}
		})
	}),
	list: Effect.gen(function* () {
		const directory = yield* pendingDirectory
		const texts = yield* Effect.try({
			catch: storageFailed('Captures waiting on this iPhone could not be read.'),
			try: () =>
				Array.filterMap(directory.exists ? directory.list() : [], entry =>
					entry instanceof File && String.endsWith('.json')(entry.name)
						? Result.succeed(entry.textSync())
						: Result.failVoid
				)
		})
		return yield* pipe(
			Effect.forEach(texts, text => Schema.decodeEffect(PendingFile)(text)),
			Effect.mapError(storageFailed('A capture waiting on this iPhone is unreadable.'))
		)
	}),
	remove: Effect.fnUntraced(function* (id: Pending['id']) {
		const directory = yield* pendingDirectory
		yield* Effect.try({
			catch: storageFailed('A sent capture could not be removed from this iPhone.'),
			try: () => {
				// The capture and the photo or video beside it share the id as their name.
				for (const entry of directory.exists ? directory.list() : []) {
					if (entry instanceof File && String.startsWith(`${id}.`)(entry.name)) entry.delete()
				}
			}
		})
	})
})

const connectionAtom = Atom.keepAlive(Atom.make<'connecting' | 'offline' | 'online'>('connecting'))

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: get =>
		pipe(
			Rpc.RpcClient.layerProtocolSocket({
				onTransientError: () => Effect.sync(() => get.set(connectionAtom, 'offline')),
				retryTransientErrors: true
			}),
			Layer.provide(
				Socket.layerWebSocket(pipe(new URL('/api/rpc', settings.server).href, String.replace(/^http/u, 'ws')))
			),
			Layer.provide(Socket.layerWebSocketConstructorGlobal),
			Layer.provide(Rpc.RpcSerialization.layerJson)
		)
}) {}

// Counts returns to the foreground. iOS suspends the socket in the background, so each return opens a fresh subscription.
const activationsAtom = Atom.make(get => {
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'active') get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})

const emptyNotes = NotesView.make({aiSpend: {month: '', usd: 0}, items: []})

const newestFirst = Order.flip(Order.mapInput(Order.Number, (item: NoteItem) => item.createdAt))

// A reset replaces the list; any other event swaps in the notes that changed and drops the ones that went away.
function apply(view: NotesView, event: NotesEvent) {
	if (event.reset) return NotesView.make({aiSpend: event.aiSpend, items: Array.sort(event.upserted, newestFirst)})
	const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, item => item.id)])
	return NotesView.make({
		aiSpend: event.aiSpend,
		items: Array.sort(
			[...Array.filter(view.items, item => !HashSet.has(replaced, item.id)), ...event.upserted],
			newestFirst
		)
	})
}

// The copy kept on this iPhone shows the notes offline. A broken copy shows nothing until the server answers.
const cachedNotes = pipe(
	Effect.try({catch: storageFailed('The saved copy is unreadable.'), try: () => cacheFile.textSync()}),
	Effect.flatMap(text => Schema.decodeEffect(CacheFile)(text)),
	Effect.orElseSucceed(() => emptyNotes)
)

export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		get(activationsAtom)
		return Stream.concat(
			Stream.fromEffect(cachedNotes),
			pipe(
				Effect.map(RpcClient, client => client('notes.watch', undefined)),
				Stream.unwrap,
				Stream.mapAccum(
					() => emptyNotes,
					(view, event) => {
						const next = apply(view, event)
						return [next, [next]] as const
					}
				),
				// A failed copy only costs the offline view, so it must not stop the live notes.
				Stream.tap(state =>
					pipe(
						Effect.sync(() => get.set(connectionAtom, 'online')),
						Effect.andThen(Schema.encodeEffect(CacheFile)(state)),
						Effect.flatMap(json =>
							Effect.try({catch: storageFailed('The notes copy failed.'), try: () => replace(cacheFile, json)})
						),
						Effect.catch(error => Effect.logWarning('The notes could not be kept on this iPhone', error))
					)
				),
				Stream.tapError(() => Effect.sync(() => get.set(connectionAtom, 'offline'))),
				Stream.retry(Schedule.spaced('2 seconds'))
			)
		)
	})
)

// A note with its long texts, loaded when its page opens. The key holds the id and what the list knows changed, so a
// note that finishes tagging loads again: `<id> <status> <title>`.
export const noteAtom = Atom.family((key: string) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('notes.get', {id: String.takeLeft(key, 36)})))
)

// Ids of the notes that hold every word, from the server's search across transcripts and pages.
export const searchAtom = Atom.family((query: string) =>
	RpcClient.runtime.atom(
		Effect.map(
			Effect.flatMap(RpcClient, client => client('notes.search', {query})),
			ids => HashSet.fromIterable(ids)
		)
	)
)

// Sends a photo or video from the outbox folder as the raw request body, straight from its file, so a long video never
// passes through JavaScript memory.
const upload = Effect.fnUntraced(function* (id: Pending['id'], name: string, type: FileType) {
	const file = new File(yield* pendingDirectory, name)
	const response = yield* Effect.tryPromise({
		catch: storageFailed('The file could not be sent.'),
		try: () =>
			new UploadTask(file, new URL(`/api/files/${id}`, settings.server).href, {
				headers: {'content-type': type},
				httpMethod: 'POST',
				uploadType: UploadType.BINARY_CONTENT
			}).uploadAsync()
	})
	if (response.status < 200 || response.status >= 300) {
		return yield* NotesError.make({message: `The server refused the file with status ${response.status}.`})
	}
})

const outboxRevisionAtom = Atom.make(0)

// Captures still on this iPhone, newest first, including what the share extension kept while offline.
export const pendingAtom = Atom.make(get =>
	Effect.gen(function* () {
		get(activationsAtom)
		get(outboxRevisionAtom)
		return Array.sort(yield* outbox.list, Order.flip(Order.mapInput(Order.Number, (item: Pending) => item.createdAt)))
	})
)

// Sends the outbox whenever the server answers and something new waits; a refused capture is tried again later.
export const deliveryAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		Effect.gen(function* () {
			get(activationsAtom)
			const revision = get(outboxRevisionAtom)
			if (get(connectionAtom) !== 'online') return
			const client = yield* RpcClient
			const result = yield* Effect.provideService(
				deliver(pending =>
					Option.match(Option.fromNullishOr(pending.file), {
						onNone: () => client('notes.capture', {id: pending.id, text: pending.text}),
						onSome: file => upload(pending.id, file.name, file.type)
					})
				),
				Outbox,
				outbox
			)
			if (result.kept > 0) yield* Effect.sleep('30 seconds')
			if (result.sent > 0 || result.kept > 0) get.set(outboxRevisionAtom, revision + 1)
		})
	)
)

function haptic(type: Haptics.NotificationFeedbackType) {
	return Effect.promise(() => Haptics.notificationAsync(type))
}

// The app has no other place to show a failure, so it buzzes and says what went wrong.
function alert(title: string) {
	return (error: {message: string}) =>
		Effect.andThen(
			haptic(Haptics.NotificationFeedbackType.Error),
			Effect.sync(() => Alert.alert(title, error.message))
		)
}

// A copied photo or screenshot becomes a file note, sent like a shared one. Its digest is remembered like a pasted link.
// The clipboard's change count when the app last saved from it, kept across launches, so a copy is offered once.
const clipboardFile = new File(Paths.document, 'clipboard.txt')

// Change counts the owner answered Not Now to; the app asks about them again only after a restart.
const declined = MutableHashSet.empty<number>()

// The open save question: what was copied and how to answer it; none while no question is open.
export const offerAtom = Atom.keepAlive(
	Atom.make(Option.none<{answer: (save: boolean) => void; kind: 'image' | 'link'}>())
)

// Reads the copied image only after the owner chose to save it, so iOS shows its paste banner only then.
const saveImage = Effect.gen(function* () {
	const image = yield* Effect.tryPromise({
		catch: storageFailed('The copied image could not be read.'),
		try: () => Clipboard.getImageAsync({format: 'jpeg', jpegQuality: 0.85})
	})
	if (image === null) return
	const id = Crypto.randomUUID()
	const directory = yield* pendingDirectory
	yield* Effect.try({
		catch: storageFailed('The copied image could not be kept on this iPhone.'),
		try: () => {
			directory.create({idempotent: true, intermediates: true})
			new File(directory, `${id}.jpg`).writeSync(String.replace(/^data:[^,]*,/u, '')(image.data), {encoding: 'base64'})
		}
	})
	yield* outbox.add({
		createdAt: yield* Clock.currentTimeMillis,
		file: {name: `${id}.jpg`, type: 'image/jpeg'},
		id,
		text: ''
	})
})

const saveLink = Effect.gen(function* () {
	const text = String.trim(
		yield* Effect.tryPromise({
			catch: storageFailed('The clipboard could not be read.'),
			try: () => Clipboard.getStringAsync()
		})
	)
	if (captureUrl(text) === null) return yield* NotesError.make({message: 'The copied text holds no link.'})
	yield* outbox.add({createdAt: yield* Clock.currentTimeMillis, id: Crypto.randomUUID(), text})
})

// Each time Stash opens with a new copy that holds a link or an image, it asks in a sheet whether to save it. Checking
// reads nothing, so iOS shows no paste banner unless the owner saves. One question is open at a time; a return to the
// app while it is open asks again in its place.
export const pasteAtom = Atom.keepAlive(
	Atom.make(get =>
		pipe(
			Effect.gen(function* () {
				get(activationsAtom)
				const count = pasteboard.changeCount()
				const handled = yield* Effect.try({
					catch: storageFailed('The last saved copy is unreadable.'),
					try: () => (clipboardFile.exists ? clipboardFile.textSync() : '')
				})
				if (handled === `${count}` || MutableHashSet.has(declined, count)) return
				const link = yield* Effect.promise(() => pasteboard.hasLink())
				const kind = pasteboard.hasImage()
					? Option.some('image' as const)
					: Option.liftPredicate('link' as const, () => link)
				if (Option.isNone(kind)) return
				const save = yield* Effect.callback<boolean>(resume => {
					get.set(
						offerAtom,
						Option.some({
							answer: (answer: boolean) => {
								get.set(offerAtom, Option.none())
								resume(Effect.succeed(answer))
							},
							kind: Option.getOrThrow(kind)
						})
					)
					return Effect.sync(() => get.set(offerAtom, Option.none()))
				})
				if (!save) {
					MutableHashSet.add(declined, count)
					return
				}
				yield* Option.getOrThrow(kind) === 'image' ? saveImage : saveLink
				yield* Effect.try({
					catch: storageFailed('The saved copy could not be remembered.'),
					try: () => replace(clipboardFile, `${count}`)
				})
				get.set(outboxRevisionAtom, get.once(outboxRevisionAtom) + 1)
				yield* haptic(Haptics.NotificationFeedbackType.Success)
			}),
			Effect.tapError(alert('Not Saved'))
		)
	)
)

// The preview image the server kept, downloaded once into the cache, because SwiftUI images read local files.
// Mount it only for a note whose preview the server already has; a failed download is tried again on the next return.
export const imageAtom = Atom.family((id: Note['id']) =>
	Atom.make(get =>
		Effect.gen(function* () {
			get(activationsAtom)
			const file = new File(imagesDirectory, id)
			if (file.exists) return file.uri
			const failed = storageFailed('The preview image could not be loaded.')
			yield* Effect.try({catch: failed, try: () => imagesDirectory.create({idempotent: true, intermediates: true})})
			const downloaded = yield* Effect.tryPromise({
				catch: failed,
				try: () => File.downloadFileAsync(new URL(`/api/images/${id}`, settings.server).href, file)
			})
			return downloaded.uri
		})
	)
)

// Reads a note's source again; the row shows its placeholder until the new note arrives.
export const regenerateAtom = RpcClient.runtime.fn((id: Note['id']) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('notes.regenerate', {id})),
		Effect.andThen(haptic(Haptics.NotificationFeedbackType.Success)),
		Effect.tapError(alert('Not Regenerated'))
	)
)

export const removeAtom = RpcClient.runtime.fn((id: Note['id']) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('notes.remove', {id})),
		Effect.andThen(haptic(Haptics.NotificationFeedbackType.Success)),
		Effect.tapError(alert('Not Deleted'))
	)
)

// A bundled image as a local file, because SwiftUI images read files. Metro gives each image a module number, which the
// web image types call a string.
export const assetAtom = Atom.family((module: number | string) =>
	Atom.make(
		Effect.map(
			Effect.promise(() => Asset.fromModule(module).downloadAsync()),
			asset => asset.localUri ?? asset.uri
		)
	)
)

// A logo's menu shape copied under a name that the patched image view reads as a 3x template image, so a menu draws it
// at 18 points in the text color.
export const menuIconAtom = Atom.family((module: number | string) =>
	Atom.make(
		Effect.gen(function* () {
			const asset = yield* Effect.promise(() => Asset.fromModule(module).downloadAsync())
			const file = new File(Paths.cache, `menu-${asset.hash ?? asset.name}.template@3x.png`)
			if (!file.exists) {
				yield* Effect.tryPromise({
					catch: storageFailed('A menu icon could not be prepared.'),
					try: () => new File(asset.localUri ?? asset.uri).copy(file)
				})
			}
			return file.uri
		})
	)
)

// Each launch and each return to the app checks for a published JavaScript update and restarts into it at once, so a
// fix never waits for a second launch. Development builds load their code from Metro and skip this.
export const updateAtom = Atom.keepAlive(
	Atom.make(get =>
		pipe(
			Effect.gen(function* () {
				get(activationsAtom)
				if (!Updates.isEnabled) return
				const failed = storageFailed('The app update could not be loaded.')
				if (!(yield* Effect.tryPromise({catch: failed, try: () => Updates.checkForUpdateAsync()})).isAvailable) return
				if (!(yield* Effect.tryPromise({catch: failed, try: () => Updates.fetchUpdateAsync()})).isNew) return
				yield* Effect.tryPromise({catch: failed, try: () => Updates.reloadAsync()})
			}),
			Effect.catch(error => Effect.logWarning('The app update check failed', error))
		)
	)
)

// A note being written stays on the iPhone at every keystroke, so closing the app never loses it.
const draftFile = new File(Paths.document, 'draft.txt')

export const draftAtom = Atom.writable(
	() => (draftFile.exists ? draftFile.textSync() : ''),
	(context, text: string) => {
		replace(draftFile, text)
		context.setSelf(text)
	}
)

// Saves a written note like a shared one: into the outbox first, then to the server, and clears the draft.
export const writeAtom = Atom.fn((text: string, get) =>
	pipe(
		Effect.gen(function* () {
			yield* outbox.add({createdAt: yield* Clock.currentTimeMillis, id: Crypto.randomUUID(), text: String.trim(text)})
			get.set(draftAtom, '')
			get.set(outboxRevisionAtom, get(outboxRevisionAtom) + 1)
			yield* haptic(Haptics.NotificationFeedbackType.Success)
		}),
		Effect.tapError(alert('Note Not Saved'))
	)
)
