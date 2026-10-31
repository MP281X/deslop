import type {Record} from 'effect'
import {Array, Boolean, Effect, Layer, HashSet, Option, Order, Predicate, Schema, Stream, String, pipe} from 'effect'

import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient} from 'effect/http'
import {AtomRpc, Atom} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import {Directory, File, Paths} from 'expo-file-system'

import {ClipboardOffer, clipboardMachine} from '@deslop/components-mobile/clipboard'
import type {ClipboardKind} from '@deslop/components-mobile/clipboard'
import {brands} from '@deslop/components-mobile/icons'
import {hues} from '@deslop/components-mobile/theme'
import {alert, cachedList, writeAtomically} from '@deslop/components-mobile/utils'
import {RpcAuth} from '@deslop/runtime/auth/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'
import * as MobileSession from '@deslop/runtime/mobile/session'

import {native} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl, isYouTube} from '#services/notes/lib/utils.ts'
import type {Kind, Note, NotesEvent} from '#services/notes/schema.ts'
import {Brand, NoteItem, NotesError} from '#services/notes/schema.ts'

const SERVER = 'https://stash.mp281x.xyz'

export const primary = hues.yellow

const listFile = new File(Paths.document, 'list.json')

// The share extension refreshes the same Keychain credentials, so a refresh holds the lock both processes take.
export const session = MobileSession.make('Stash', SERVER, {
	clear: Effect.try(() => native.clearSession()),
	lock: Effect.acquireRelease(
		Effect.tryPromise(() => native.lockSession()),
		lock => Effect.promise(() => native.unlockSession(lock))
	),
	read: Effect.try(() => native.getSession()),
	write: text => Effect.try(() => native.setSession(text))
})

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: pipe(
		MobileRuntime.layer('@deslop/stash', session.accessToken)(SERVER),
		Layer.provideMerge(RpcAuth.layerClient(session.accessToken)),
		Layer.provide(FetchHttpClient.layer)
	)
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
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

// The site a web page is on, such as github.com.
export function siteOf(note: NoteItem) {
	return pipe(
		Option.fromNullishOr(note.url),
		Option.filter(() => kindOf(note) === 'web'),
		Option.flatMap(url => Option.liftThrowable(() => new URL(url).hostname)()),
		Option.map(String.replace(/^www\./u, ''))
	)
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

const newestFirst = Order.flip(Order.mapInput(Order.Number, (item: NoteItem) => item.createdAt))

function apply(items: NoteItem[], event: NotesEvent) {
	if (event.reset) return Array.sort(event.upserted, newestFirst)
	const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, item => item.id)])
	return Array.sort([...Array.filter(items, item => !HashSet.has(replaced, item.id)), ...event.upserted], newestFirst)
}

// The copy on the iPhone shows the list while the server is out of reach.
export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.succeed(Array.empty<NoteItem>())
		return cachedList(
			get,
			listFile,
			NoteItem,
			pipe(
				Stream.unwrap(Effect.map(RpcClient, client => client('notes.watch', undefined))),
				Stream.scan(Array.empty<NoteItem>, apply),
				Stream.drop(1),
				session.renewing
			)
		)
	})
)

// The list replaces an item when its note changes, so the new item loads the note again.
export const noteAtom = Atom.family((item: NoteItem) =>
	RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('notes.get', {id: item.id})))
)

export const queryAtom = Atom.make('')

// One atom for every query keeps the previous results on screen; each keystroke restarts the wait, so the server searches once typing pauses.
export const searchAtom = RpcClient.runtime.atom(get => {
	const query = String.trim(get(queryAtom))
	if (String.isEmpty(query)) return Effect.succeedNone
	return pipe(
		Effect.sleep('250 millis'),
		Effect.andThen(Effect.flatMap(RpcClient, client => client('notes.search', {query}))),
		Effect.map(ids => Option.some(HashSet.fromIterable(ids)))
	)
})

const images = new Directory(Paths.cache, 'downloads')

// SwiftUI images read local files, so each note's preview is downloaded once into the cache; a failed download tries again on the next return to the app.
export const imageAtom = Atom.family((id: Note['id']) =>
	session.runtime.atom(get => {
		get(MobileRuntime.activationsAtom)
		return Effect.gen(function* () {
			const file = new File(images, id)
			if (file.exists) return file.uri
			images.create({idempotent: true, intermediates: true})
			const token = yield* session.accessToken
			const downloaded = yield* Effect.tryPromise(() =>
				File.downloadFileAsync(new URL(`/api/images/${id}`, SERVER).href, file, {
					headers: {authorization: `Bearer ${token}`}
				})
			)
			return downloaded.uri
		})
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

type Offer = {count: string; kind: ClipboardKind}

const saveImage = Effect.fnUntraced(function* () {
	const token = yield* session.accessToken
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
				return file.upload(new URL(`/api/files/${id}`, SERVER).href, {
					headers: {authorization: `Bearer ${token}`, 'content-type': 'image/jpeg'},
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

// A copy is offered once: the change count it was answered at is kept, so the next return offers only a newer copy.
export const clipboardAtom = AtomMachine.bind(
	Atom.runtime(get =>
		Layer.succeed(
			ClipboardOffer,
			ClipboardOffer.of({
				// The sheet closes at once; the note arrives in the list when the server has it.
				answer: Effect.fnUntraced(function* (answer: Offer & {save: boolean}) {
					yield* pipe(
						Effect.try({
							catch: cause => NotesError.make({cause, message: 'The answer could not be kept on this iPhone.'}),
							try: () => writeAtomically(clipboardFile, answer.count)
						}),
						Effect.andThen(
							Boolean.match(answer.save, {
								onFalse: () => Effect.void,
								onTrue: () =>
									Boolean.match(answer.kind === 'image', {
										onFalse: () =>
											Effect.flatMap(get.result(RpcClient.runtime), context =>
												Effect.provideContext(saveLink, context)
											),
										// @effect-diagnostics-next-line strictEffectProvide:off -- The RPC runtime exposes only its client, so the upload brings its own fetch.
										onTrue: () => Effect.provide(saveImage(), FetchHttpClient.layer)
									})
							})
						),
						alert('Not Saved'),
						Effect.ignore({log: 'Warn', message: 'The clipboard note was not saved'})
					)
				}),
				detect: Effect.gen(function* () {
					if (yield* Effect.promise(() => Clipboard.hasImageAsync())) return Option.some<ClipboardKind>('image')
					if (yield* Effect.promise(() => native.hasLink())) return Option.some<ClipboardKind>('link')
					return Option.none<ClipboardKind>()
				}),
				file: clipboardFile
			})
		)
	)
).make(clipboardMachine)

// Each return from the background looks at the clipboard again.
export const clipboardReturnsAtom = Atom.make(get => {
	get(MobileRuntime.activationsAtom)
	get.set(clipboardAtom.send, {_tag: 'Returned'})
})
