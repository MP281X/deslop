import {Component, Mount} from '@effect/ui'
import {Markdown, MarkdownParser} from '@effect/ui/html'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Option, Result, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {isDeniedCause} from '@deslop/runtime/client/live-stream'
import {Button} from '@deslop/ui/control'

import {sourceLabelOf, subjectOf} from '#lib/kinds.ts'
import {webLinksOnly} from '#lib/markdown.ts'
import {StashNative, atDevice} from '#lib/native.ts'
import type {Page} from '#lib/pages.ts'
import {pagesOf} from '#lib/pages.ts'
import {installed} from '#lib/session.ts'
import {Message} from '#routes/model.ts'
import type {Model} from '#routes/model.ts'
import {ImageType} from '#services/notes/schema.ts'
import type {NoteItem} from '#services/notes/schema.ts'

type H = Html.H<Message>

const LoadPicture = Mount.make('Stash/LoadPicture', {args: {path: Schema.String}}, (node: HTMLImageElement, args) =>
	pipe(
		Effect.gen(function* () {
			yield* Effect.callback<void>(resume => {
				const observer = new IntersectionObserver(entries => {
					if (Array.some(entries, entry => entry.isIntersecting)) resume(Effect.void)
				})
				observer.observe(node)
				return Effect.sync(() => observer.disconnect())
			})
			const result = yield* atDevice('Picture unavailable', () => StashNative.image({path: args.path}))
			if (Schema.is(ImageType)(result.type)) node.setAttribute('src', `data:${result.type};base64,${result.data}`)
		}),
		Effect.ignore({log: 'Warn', message: 'The note picture could not be loaded'}),
		Effect.as(Component.noop)
	)
)

export function picture(h: H, path: string, css: string) {
	const image = h.img.key(path).class(css).attr('alt', '')
	if (installed) return image.onMount(LoadPicture({path}))
	return image.attrs({loading: 'lazy', src: path})
}

export function coverOf(note: NoteItem) {
	return `/api/images/${note.id}`
}

function picturePath(note: NoteItem, page: Page) {
	if (page.kind === 'cover') return coverOf(note)
	return `/api/notes/${page.path}`
}

function gallery(h: H, note: NoteItem, count: number) {
	const pages = pagesOf(Option.isSome(note.image), note.id, count)
	if (Array.isReadonlyArrayEmpty(pages)) return undefined
	return h.div
		.class('stash-gallery')
		.attr('aria-label', 'Note pictures')
		.children(Array.map(pages, page => picture(h, picturePath(note, page), 'stash-cover')))
}

export function isWebLink(url: string) {
	return Option.isSome(String.match(/^https?:\/\//iu)(url))
}

function prose(h: H, body: string) {
	return Result.match(
		Result.try({catch: Function.identity, try: () => MarkdownParser.parseMarkdown(webLinksOnly(body))}),
		{
			onFailure: () => h.p.class('stash-plaintext').children(body),
			onSuccess: document =>
				Markdown.view(h, document, {
					views: {
						Heading: (node, _heading, content) => node.h2.children(content),
						Image: (node, image) => node.span.children(image.alt),
						Link: (node, link, content) => {
							if (!isWebLink(link.url)) return node.span.children(content)
							return node.a.attrs({href: link.url, rel: 'noreferrer', target: '_blank'}).children(content)
						}
					}
				}).class('stash-prose')
		}
	)
}

export function issueOf(note: NoteItem) {
	return Option.getOrElse(note.issue, () => `Couldn’t read this ${subjectOf(note)}`)
}

function denied(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return AsyncResult.isFailure(result) && isDeniedCause(result.cause)
}

export function reader(h: H, state: Model, note: NoteItem, date: string) {
	if (denied(state.body) || denied(state.media)) {
		return h.p.class('stash-notice').attr('role', 'status').children('Access denied')
	}
	const body = pipe(
		AsyncResult.value(state.body),
		Option.flatMap(full => full.body),
		Option.getOrUndefined
	)
	const count = Option.getOrElse(AsyncResult.value(state.media), Function.constant(0))
	const pictureFailed = AsyncResult.isFailure(state.media)
	const noteFailed = AsyncResult.isFailure(state.body)
	return h.article.class('stash-reader').children(
		gallery(h, note, count),
		h.h1.children(note.title),
		h.p.class('stash-byline').children(`${sourceLabelOf(note)} · ${date}`),
		note.status === 'organizing' &&
			h.p
				.class('stash-byline')
				.attr('role', 'status')
				.children(`Reading this ${subjectOf(note)}…`),
		note.status === 'failed' && h.p.class('stash-problem').children(h.span.class('axis-dot'), issueOf(note)),
		String.isNonEmpty(note.summary) && h.p.class('stash-summary').children(note.summary),
		body !== undefined && prose(h, body),
		(noteFailed || pictureFailed) &&
			h.p
				.class('stash-problem')
				.children(
					h.span.class('axis-dot'),
					Boolean.match(noteFailed, {
						onFalse: Function.constant('Pictures unavailable'),
						onTrue: Function.constant('Note body unavailable')
					}),
					Button(h).class('stash-inline-action').on('click', Message.Retry()).children('Retry')
				),
		AsyncResult.isInitial(state.body) &&
			note.status === 'ready' &&
			h.p.class('stash-byline').attr('role', 'status').children('Loading note…'),
		Array.isReadonlyArrayNonEmpty(note.tags) &&
			h.div.class('stash-tags').children(
				Array.map(note.tags, tag =>
					Button(h, {pressed: tag === state.tag})
						.key(tag)
						.on(
							'click',
							Message.FilterTag({tag: Option.getOrUndefined(Option.liftPredicate(tag, name => name !== state.tag))})
						)
						.children(tag)
				)
			)
	)
}
