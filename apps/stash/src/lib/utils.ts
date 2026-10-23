import type {Record} from 'effect'
import {
	Array,
	Boolean,
	Clock,
	Effect,
	FiberHandle,
	Layer,
	HashSet,
	Option,
	Order,
	Predicate,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, AtomRpc, Atom} from 'effect/reactivity'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import {Directory, File, Paths} from 'expo-file-system'

import {brands} from '@deslop/components-mobile/icons'
import {alert, writeAtomically} from '@deslop/components-mobile/utils'
import {AuthError, ClientRegistration, Credentials, TokenResponse} from '@deslop/runtime/auth/schema'
import {AUTH_URL, RpcAuth} from '@deslop/runtime/auth/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'

import {native} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {captureUrl, isYouTube} from '#services/notes/lib/utils.ts'
import type {Kind, Note, NotesEvent} from '#services/notes/schema.ts'
import {Brand, NoteItem, NotesError} from '#services/notes/schema.ts'

const SERVER = 'https://stash.mp281x.xyz'
const TELEMETRY = 'https://otel.mp281x.xyz'
const DISCOVERY = {
	authorizationEndpoint: `${AUTH_URL}/api/auth/oauth2/authorize`,
	tokenEndpoint: `${AUTH_URL}/api/auth/oauth2/token`
}
const authRuntime = Atom.runtime(FetchHttpClient.layer)
const sessionLock = Effect.acquireRelease(
	Effect.tryPromise(() => native.lockSession()),
	lock => Effect.promise(() => native.unlockSession(lock))
)

const listFile = new File(Paths.document, 'list.json')

const readSession = Effect.gen(function* () {
	const text = yield* Effect.try(() => native.getSession())
	if (String.isEmpty(text)) return Option.none<Credentials>()
	return Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(Credentials))(text))
})
export const sessionAtom = Atom.keepAlive(authRuntime.atom(readSession))

const saveSession = Effect.fnUntraced(function* (clientId: string, response: TokenResponse) {
	const credentials = {
		accessToken: response.access_token,
		clientId,
		expiresAt: (yield* Clock.currentTimeMillis) + response.expires_in * 1000,
		refreshToken: response.refresh_token
	}
	const text = yield* Schema.encodeEffect(Schema.fromJsonString(Credentials))(credentials)
	yield* Effect.try(() => native.setSession(text))
	return credentials.accessToken
})

const tokenRequest = Effect.fnUntraced(function* (clientId: string, params: Record<string, string>) {
	const response = yield* (yield* HttpClient.HttpClient).execute(
		pipe(
			HttpClientRequest.post(DISCOVERY.tokenEndpoint),
			HttpClientRequest.bodyUrlParams({...params, client_id: clientId, resource: [SERVER, TELEMETRY]})
		)
	)
	if (response.status === 400 || response.status === 401) {
		yield* Effect.try(() => native.clearSession())
		return yield* AuthError.make({message: 'Sign in to Stash again'})
	}
	return yield* saveSession(clientId, yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response))
}, Effect.timeout('10 seconds'))

const accessToken = pipe(
	Effect.gen(function* () {
		yield* sessionLock
		const credentials = yield* Effect.fromOption(yield* readSession)
		if (credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000) return credentials.accessToken
		return yield* tokenRequest(credentials.clientId, {
			grant_type: 'refresh_token',
			refresh_token: credentials.refreshToken
		})
	}),
	Effect.scoped,
	Effect.mapError(cause => AuthError.make({cause, message: 'Sign in to Stash'}))
)

export const signInAtom = authRuntime.fn(() =>
	pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: MobileRuntime.extra.scheme})
			const client = yield* HttpClient.HttpClient
			const registration = yield* pipe(
				HttpClientRequest.post(`${AUTH_URL}/api/auth/oauth2/register`),
				HttpClientRequest.bodyJson({
					application_type: 'native',
					client_name: 'Stash',
					grant_types: ['authorization_code', 'refresh_token'],
					redirect_uris: [redirectUri],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration))
			)
			const request = new AuthRequest({
				clientId: registration.client_id,
				extraParams: {resource: SERVER},
				redirectUri,
				scopes: ['deslop', 'offline_access']
			})
			const url = new URL(yield* Effect.tryPromise(() => request.makeAuthUrlAsync(DISCOVERY)))
			url.searchParams.append('resource', TELEMETRY)
			const result = yield* Effect.tryPromise(() => request.promptAsync(DISCOVERY, {url: url.href}))
			if (result.type !== 'success') return yield* AuthError.make({message: 'Sign-in was not completed'})
			if (result.params['iss'] !== `${AUTH_URL}/api/auth`) {
				return yield* AuthError.make({message: 'The sign-in issuer did not match'})
			}
			yield* Effect.scoped(
				Effect.andThen(
					sessionLock,
					tokenRequest(registration.client_id, {
						code: result.params['code'] ?? '',
						code_verifier: request.codeVerifier ?? '',
						grant_type: 'authorization_code',
						redirect_uri: redirectUri
					})
				)
			)
			yield* Atom.refresh(sessionAtom)
		}),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign in to Stash'})),
		alert('Not Signed In')
	)
)

export const signOutAtom = Atom.keepAlive(
	authRuntime.fn(() =>
		pipe(
			Effect.gen(function* () {
				const session = yield* Effect.scoped(
					Effect.gen(function* () {
						yield* sessionLock
						const saved = yield* readSession
						yield* Effect.try(() => native.clearSession())
						return saved
					})
				)
				yield* Atom.refresh(sessionAtom)
				yield* pipe(
					Effect.forEach(
						Option.toArray(session),
						saved =>
							pipe(
								HttpClientRequest.post(`${AUTH_URL}/api/auth/oauth2/revoke`),
								HttpClientRequest.bodyUrlParams({
									client_id: saved.clientId,
									token: saved.refreshToken,
									token_type_hint: 'refresh_token'
								}),
								request => HttpClient.HttpClient.use(client => client.execute(request))
							),
						{concurrency: 1}
					),
					Effect.timeout('30 seconds'),
					Effect.ignore({log: 'Warn', message: 'The server session could not be revoked; signing out on this iPhone'})
				)
			}),
			Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign out'})),
			alert('Not Signed Out')
		)
	)
)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: pipe(
		MobileRuntime.layer('@deslop/stash', accessToken)(SERVER),
		Layer.provideMerge(RpcAuth.layerClient(accessToken)),
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
		const session = get(sessionAtom)
		if (!AsyncResult.isSuccess(session) || Option.isNone(session.value)) return Stream.succeed(Array.empty<NoteItem>())
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
				Effect.gen(function* () {
					// The copy is written once the list settles, off the path that shows each change.
					const writes = yield* FiberHandle.make()
					return pipe(
						(yield* RpcClient)('notes.watch', undefined),
						Stream.scan(Array.empty<NoteItem>, apply),
						Stream.drop(1),
						Stream.tap(items =>
							FiberHandle.run(
								writes,
								pipe(
									Schema.encodeEffect(ListJson)(items),
									Effect.flatMap(json => Effect.try(() => writeAtomically(listFile, json))),
									Effect.delay('2 seconds'),
									Effect.ignore({log: 'Warn', message: 'The list could not be kept on this iPhone'})
								)
							)
						)
					)
				}),
				Stream.unwrap,
				// Refreshing the session restarts this list, so it happens only once the session is gone; any other failure waits for the retry.
				Stream.tapError(() =>
					pipe(
						readSession,
						Effect.flatMap(saved =>
							Option.match(saved, {onNone: () => Atom.refresh(sessionAtom), onSome: () => Effect.void})
						),
						Effect.ignore({log: 'Warn', message: 'The session could not be read'})
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

// SwiftUI images read local files, so each note's preview is downloaded once into the cache; a failed download stays failed until the app restarts.
export const imageAtom = Atom.family((id: Note['id']) =>
	authRuntime.atom(
		Effect.gen(function* () {
			const file = new File(images, id)
			if (file.exists) return file.uri
			images.create({idempotent: true, intermediates: true})
			const token = yield* accessToken
			const downloaded = yield* Effect.tryPromise(() =>
				File.downloadFileAsync(new URL(`/api/images/${id}`, SERVER).href, file, {
					headers: {authorization: `Bearer ${token}`}
				})
			)
			return downloaded.uri
		})
	)
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
			const count = `${native.changeCount()}`
			if (clipboardFile.exists && clipboardFile.textSync() === count) return Option.none<Offer>()
			if (yield* Effect.promise(() => Clipboard.hasImageAsync())) return Option.some<Offer>({count, kind: 'image'})
			if (yield* Effect.promise(() => native.hasLink())) return Option.some<Offer>({count, kind: 'link'})
			return Option.none<Offer>()
		})
	)
)

const saveImage = Effect.fnUntraced(function* () {
	const token = yield* accessToken
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

const saveAtom = Atom.keepAlive(
	authRuntime.fn((kind: Offer['kind'], get) =>
		pipe(
			Boolean.match(kind === 'image', {onFalse: () => withClient(get, saveLink), onTrue: () => saveImage()}),
			alert('Not Saved')
		)
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
