import './stash.css'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html, Markdown} from '@effect/ui/html'

import {Array, Effect, Layer, Option, Predicate, Result, Stream, String, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {FetchHttpClient, HttpBody, HttpClient} from 'effect/http'

import type {PaneLeaf, Press} from '@deslop/components/model'
import {ListDetail, styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {SignOut} from '@deslop/runtime/client/shell'
import {AuthError} from '@deslop/runtime/shared/auth'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {StashApp} from '#app'
import type {Reader, StashScreen} from '#app'
import {Device, StashRoute, layerStash} from '#reads'
import {Workspace} from '#view'
import type {StashUi} from '#view'

import {NoteId, NotesError} from '#notes/contract.ts'
import type {TagName} from '#notes/contract.ts'
import {parseBody} from '#notes/screen.ts'
import {copiedLink, isWebLink} from '#notes/shared.ts'

const components = webComponents<never>()

// A button as the web draws it: a plain button in the Stash style, which a disabled one leaves unpressable.
function Control<M>(h: Html.H<M>, press: Press, disabled = false) {
	const element = press(h.button, 'click').attr('type', 'button').class('stash-button')
	if (!disabled) return element
	return element.disabled(true).attr('data-disabled', '')
}

function TagButton<M>(h: Html.H<M>, screen: StashScreen, tag: TagName, count?: number) {
	return screen
		.filter(h.button, 'click', tag)
		.key(tag)
		.attr('type', 'button')
		.attr('aria-pressed', `${screen.tag === tag}`)
		.children(tag, count !== undefined && h.small.children(`${count}`))
}

function report<M>(h: Html.H<M>, screen: StashScreen) {
	if (screen.report === undefined) return undefined
	return h.div
		.class('stash-report')
		.attr('role', 'alert')
		.children(h.p.children(screen.report), Control(h, screen.dismissProblem).children('Dismiss'))
}

// What stands in for the notes when there is a message and a way on.
function Gate(h: Html.H<never>, screen: StashScreen, message: string, action: PaneLeaf<View.Input<never>>) {
	return components.layout(h, {
		content: h.div.class('stash-gate').children(h.p.attr('role', 'status').children(message), action, report(h, screen))
	})
}

function body<M>(h: Html.H<M>, raw: string) {
	return Result.match(parseBody(raw), {
		onFailure: () => h.p.class('stash-plaintext').children(raw),
		onSuccess: document =>
			Markdown.view(h, document, {
				views: {
					Heading: (node, _, content) => node.h2.children(content),
					Image: (node, image) => node.span.children(image.alt),
					Link: (node, link, content) => {
						if (!isWebLink(link.url)) return node.span.children(content)
						return node.a.attrs({href: link.url, rel: 'noreferrer', target: '_blank'}).children(content)
					}
				}
			}).class('stash-prose')
	})
}

const logos = {
	tiktok: new URL('./assets/tiktok.svg', import.meta.url).href,
	x: new URL('./assets/x.svg', import.meta.url).href,
	youtube: new URL('./assets/youtube.svg', import.meta.url).href
}

function sourceIcon<M>(h: Html.H<M>, note: Reader) {
	if (note.kind === 'file' || note.kind === 'note' || note.kind === 'web') return undefined
	return h.img.class('stash-source-logo').attrs({alt: '', src: logos[note.kind]})
}

function Skeleton<M>(h: Html.H<M>) {
	return h.div
		.class('stash-body-skeleton')
		.attrs({'aria-label': 'Loading note', role: 'status'})
		.children(h.div, h.div, h.div, h.div)
}

function ReaderView(h: Html.H<never>, screen: StashScreen, note: Reader) {
	if (note.denied) return h.p.style(webStyle(styles.line)).children('Access denied')
	return h.article.class('stash-reader').children(
		h.h1.style(webStyle(styles.heading)).children(note.title),
		h.div.class('stash-meta').children(h.span.children(sourceIcon(h, note), note.source), h.time.children(note.saved)),
		Array.isReadonlyArrayNonEmpty(note.pictures) &&
			h.div
				.class('stash-gallery')
				.attr('aria-label', 'Note pictures')
				.children(
					Array.map(note.pictures, (path, index) =>
						h.div
							.key(path)
							.children(
								h.img.attrs({alt: `Picture ${index + 1} of ${note.pictures.length}`, loading: 'lazy', src: path})
							)
					)
				),
		note.status !== undefined &&
			h.p
				.class('stash-status')
				.attr('role', 'status')
				.children(note.statusFailed && h.span.class('stash-error-dot'), note.status),
		String.isNonEmpty(note.summary) && h.p.class('stash-summary').children(note.summary),
		Array.isReadonlyArrayNonEmpty(note.tags) &&
			h.div
				.class('stash-tags')
				.attr('aria-label', 'Note tags')
				.children(Array.map(note.tags, entry => TagButton(h, screen, entry.tag, entry.count))),
		note.body !== undefined && body(h, note.body),
		note.loading && Skeleton(h),
		note.retry !== undefined &&
			h.p
				.class('stash-status')
				.children(h.span.class('stash-error-dot'), note.retry, Control(h, screen.retry).children('Retry')),
		!note.loading &&
			Array.isReadonlyArrayNonEmpty(note.related) &&
			h.section
				.class('stash-related')
				.attr('aria-label', 'Related notes')
				.children(
					h.p.style(webStyle(styles.line)).children('Related notes'),
					Array.map(note.related, item => components.row(h, {active: false, item, select: screen.selection.select}))
				)
	)
}

const drawing: StashUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...components,
	header: (h, screen) =>
		h.div.key('tags').children(
			Array.isReadonlyArrayNonEmpty(screen.tags) &&
				h.div
					.class('stash-tags stash-queue-tags')
					.attr('aria-label', 'Filter by tag')
					.children(
						screen
							.filter(h.button, 'click', undefined)
							.attr('type', 'button')
							.attr('aria-pressed', `${screen.tag === undefined}`)
							.children('All'),
						Array.map(screen.tags, entry => TagButton(h, screen, entry.tag))
					)
		),
	leave: h =>
		components.layout(h, {
			content: h.div.class('stash-gate').children(h.a.attr('href', '/').children('Back to Stash'))
		}),
	list: (h, rows, note) => h.div.key('notes').children(rows, note),
	loadingNote: Skeleton,
	note: (h, screen, text, retryable) =>
		h.p
			.style(webStyle(styles.line))
			.class('stash-notice')
			.attr('role', 'status')
			.children(text, retryable && Control(h, screen.retry).children('Retry')),
	reader: ReaderView,
	retry: (h, screen, message) => Gate(h, screen, message, Control(h, screen.retry).children('Retry')),
	sheet: (h, screen) => ({
		body: screen
			.draftInput(h.textarea, 'input')
			.class('stash-draft')
			.attrs({'aria-label': 'Write a note', autofocus: '', maxlength: '20000', placeholder: 'Write a note'})
			.value(screen.draft)
	}),
	signIn: (h, screen, message) =>
		Gate(h, screen, message, Control(h, screen.signIn, screen.pending).children('Continue with GitHub')),
	stage: (h, screen, options) =>
		h.div.class('stash-workspace').children(
			ListDetail<never, never>(h, {
				...options,
				sheet: pipe(
					Option.fromUndefinedOr(options.sheet),
					Option.map(sheet => ({
						...sheet,
						actions: [
							Control(h, screen.dismiss).children('Cancel'),
							Control(h, screen.save, screen.saveDisabled).children('Save')
						]
					})),
					Option.getOrUndefined
				)
			}),
			report(h, screen)
		)
}

const App = StashApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

/* oxlint-disable typescript/no-restricted-types -- Clipboard and canvas return browser Promises. */
function atDevice<A>(message: string, call: () => Promise<A>) {
	return Effect.tryPromise({catch: cause => NotesError.make({cause, message}), try: call})
}
/* oxlint-enable typescript/no-restricted-types */

const jpeg = Effect.fnUntraced(function* (image: Blob) {
	const bitmap = yield* Effect.acquireRelease(
		atDevice('The copied image could not be read.', () => createImageBitmap(image)),
		value => Effect.sync(() => value.close())
	)
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const ctx = canvas.getContext('2d', {alpha: false})
	if (ctx === null) return yield* NotesError.make({message: 'The copied image could not be read.'})
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(bitmap, 0, 0)
	return yield* Effect.callback<Blob, NotesError>(resume => {
		canvas.toBlob(
			blob => {
				if (blob === null) resume(Effect.fail(NotesError.make({message: 'The copied image could not be read.'})))
				else resume(Effect.succeed(blob))
			},
			'image/jpeg',
			0.9
		)
	})
}, Effect.scoped)

const sendImage = Effect.fnUntraced(function* (image: Blob) {
	const jpegImage = yield* jpeg(image)
	if (jpegImage.size > 20_000_000) {
		return yield* NotesError.make({message: 'The copied image is larger than 20 MB.'})
	}
	const buffer = yield* atDevice('The copied image could not be read.', () => jpegImage.arrayBuffer())
	const response = yield* HttpClient.post(`/api/files/${NoteId.make(SecureRandom.uuidV4Unsafe())}`, {
		body: HttpBody.uint8Array(new Uint8Array(buffer), 'image/jpeg')
	})
	if (response.status >= 300) {
		return yield* NotesError.make({message: (yield* response.text) || 'The copied image could not be saved.'})
	}
})

const paste = Effect.catchTag(
	Effect.gen(function* () {
		const photo = pipe(
			yield* atDevice('The clipboard could not be read.', () => navigator.clipboard.read()),
			Array.findFirst(item =>
				pipe(
					item.types,
					Array.findFirst(String.startsWith('image/')),
					Option.map(type => ({item, type}))
				)
			),
			Option.getOrUndefined
		)
		if (photo !== undefined) {
			yield* sendImage(yield* atDevice('The copied image could not be read.', () => photo.item.getType(photo.type)))
			return Option.none<string>()
		}
		return Option.some(
			yield* copiedLink(yield* atDevice('The copied link could not be read.', () => navigator.clipboard.readText()))
		)
	}),
	'HttpClientError',
	cause => NotesError.make({cause, message: 'The copied image could not be saved.'})
)

function share(text: string) {
	if (Predicate.hasProperty(navigator, 'share')) {
		return Effect.catchIf(
			Effect.tryPromise({
				catch: cause => NotesError.make({cause, message: 'The share sheet could not open.'}),
				try: () => navigator.share({text})
			}),
			error => error.cause instanceof DOMException && error.cause.name === 'AbortError',
			() => Effect.void
		)
	}
	return Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The note could not be copied.'}),
		try: () => navigator.clipboard.writeText(text)
	})
}

// The page reads the clipboard and shares through the browser, keeps the draft in its storage, and has no queued shares to hand over.
const layerDevice = Layer.provide(
	Layer.effect(
		Device,
		Effect.map(HttpClient.HttpClient, client => ({
			activation: Stream.never,
			narrow: () => matchMedia('(width < 640px), (640px <= width < 800px) and (height < 600px)').matches,
			openLink: (url: string) =>
				Effect.sync(() => {
					open(url, '_blank', 'noreferrer')
				}),
			paste: Effect.provideService(paste, HttpClient.HttpClient, client),
			readDraft: () => localStorage.getItem('stash.draft') ?? '',
			settleShares: Effect.succeed([]),
			share,
			writeDraft: (text: string) => {
				localStorage.setItem('stash.draft', text)
			}
		}))
	),
	FetchHttpClient.layer
)

// Auth's own sign-out answers with a redirect, which fetch shows as an opaque response with status 0; the page reloads to ask who it is again.
const layerSignOut = Layer.provide(
	SignOut.toLayer(
		Effect.map(HttpClient.HttpClient, client =>
			Effect.fnUntraced(function* () {
				const response = yield* pipe(
					client.post('/auth/sign-out'),
					Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'manual'}),
					Effect.mapError(cause => AuthError.make({cause, message: 'Auth could not confirm sign-out'}))
				)
				if (response.status !== 0) return yield* AuthError.make({message: 'Auth could not confirm sign-out'})
				location.reload()
				return true
			})
		)
	),
	FetchHttpClient.layer
)

mountPage(StashRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(StashRoute), root),
		Layer.provideMerge(
			layerStash,
			Layer.mergeAll(layerDevice, layerSignOut, layerWebShell('stash', {autoSignIn: false}))
		)
	)
)
