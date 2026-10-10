import {Array, Clock, Effect, Layer, Option, Order, Result, Schedule, Schema, Stream, String, pipe} from 'effect'

import {AtomRpc, Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import {Directory, File, Paths} from 'expo-file-system'
import * as Haptics from 'expo-haptics'
import {Alert, AppState} from 'react-native'

import {Outbox, Pending, deliver} from '#lib/outbox.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {NotesError, NotesState} from '#services/notes/schema.ts'

// app.config.ts writes these for each build variant.
const settings = Schema.decodeUnknownSync(Schema.Struct({appGroup: Schema.String, server: Schema.String}))(
	Constants.expoConfig?.extra
)

const pastedFile = new File(Paths.document, 'pasted.txt')
const cacheFile = new File(Paths.document, 'notes.json')
const imagesDirectory = new Directory(Paths.cache, 'images')

type PendingFile = typeof PendingFile.Type
const PendingFile = Schema.fromJsonString(Pending)

type CacheFile = typeof CacheFile.Type
const CacheFile = Schema.fromJsonString(NotesState)

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
				const file = new File(directory, `${id}.json`)
				if (file.exists) file.delete()
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

const emptyNotes = NotesState.make({aiSpend: {month: '', usd: 0}, notes: []})

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
				deliver(capture => client('notes.capture', capture)),
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

// Each time Stash opens, a copied link becomes a note. The last pasted text is remembered,
// so opening Stash again with the same clipboard saves nothing twice.
export const pasteAtom = Atom.keepAlive(
	Atom.make(get =>
		pipe(
			Effect.gen(function* () {
				get(activationsAtom)
				const clipboardFailed = storageFailed('The clipboard could not be read.')
				// Checking for text does not show iOS's paste prompt; reading it does, unless pasting is allowed in Settings.
				if (!(yield* Effect.tryPromise({catch: clipboardFailed, try: () => Clipboard.hasStringAsync()}))) return
				const text = String.trim(
					yield* Effect.tryPromise({catch: clipboardFailed, try: () => Clipboard.getStringAsync()})
				)
				const last = yield* Effect.try({
					catch: storageFailed('The last pasted link is unreadable.'),
					try: () => (pastedFile.exists ? pastedFile.textSync() : '')
				})
				if (captureUrl(text) === null || text === last) return
				yield* outbox.add({createdAt: yield* Clock.currentTimeMillis, id: Crypto.randomUUID(), text})
				yield* Effect.try({
					catch: storageFailed('The pasted link could not be remembered.'),
					try: () => replace(pastedFile, text)
				})
				get.set(outboxRevisionAtom, get.once(outboxRevisionAtom) + 1)
				yield* haptic(Haptics.NotificationFeedbackType.Success)
			}),
			Effect.tapError(alert('Link Not Saved'))
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

export const removeAtom = RpcClient.runtime.fn((id: Note['id']) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('notes.remove', {id})),
		Effect.andThen(haptic(Haptics.NotificationFeedbackType.Success)),
		Effect.tapError(alert('Not Deleted'))
	)
)
