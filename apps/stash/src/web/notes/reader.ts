import {Component, Mount} from '@effect/ui'
import {Markdown, MarkdownParser} from '@effect/ui/html'
import type {Html} from '@effect/ui/html'

import {
	Array,
	Boolean,
	DateTime,
	Effect,
	Function,
	Option,
	Order,
	Predicate,
	Result,
	Schema,
	String,
	pipe
} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {isDeniedCause} from '@deslop/runtime/client/live-stream'
import {countOf} from '@deslop/runtime/shared/format'
import {Loading, Notice, Placeholder} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {isNative} from '@deslop/ui/native'

import {ImageType} from '#contracts'
import type {NoteItem} from '#contracts'

import {kindOf, sourceLabelOf, subjectOf} from '#web/notes/kinds.ts'
import {webLinksOnly} from '#web/notes/markdown.ts'
import {Message} from '#web/notes/model.ts'
import type {Model} from '#web/notes/model.ts'
import {StashNative, atDevice} from '#web/notes/native.ts'
import {pagesOf} from '#web/notes/pages.ts'
import type {Page} from '#web/notes/pages.ts'
import {issueOf, kindGlyph, noteRow} from '#web/notes/queue.ts'

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

export function picture(h: Html.H<Message>, path: string, css: string) {
	const image = h.img.key(path).class(css).attr('alt', '')
	if (isNative) return image.onMount(LoadPicture({path}))
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

function prose(h: H, document: Markdown.Document, points?: Markdown.List) {
	return Markdown.view(h, document, {
		views: {
			Heading: (node, heading, content) => {
				const title = node.h2.children(content)
				if (document.blocks[0] === heading && points !== undefined) return title.class('sr-only')
				return title
			},
			Image: (node, image) => node.span.children(image.alt),
			Link: (node, link, content) => {
				if (!isWebLink(link.url)) return node.span.children(content)
				return node.a.attrs({href: link.url, rel: 'noreferrer', target: '_blank'}).children(content)
			},
			List: (node, list, items) => {
				if (list === points) return node.ol.class('stash-points').children(items)
				if (!list.isOrdered) return node.ul.children(items)
				return node.ol
					.attr(
						'start',
						pipe(
							list.startNumber,
							Option.map(start => `${start}`),
							Option.getOrUndefined
						)
					)
					.children(items)
			}
		}
	}).class('stash-prose')
}

function relatedNotes(h: H, related: readonly NoteItem[]) {
	if (Array.isReadonlyArrayEmpty(related)) return undefined
	return h.section
		.class('stash-related')
		.attr('aria-label', 'Related notes')
		.children(
			h.p.children(
				countOf(related.length),
				Boolean.match(related.length === 1, {
					onFalse: Function.constant(' saves share a tag'),
					onTrue: Function.constant(' save shares a tag')
				})
			),
			pipe(
				related,
				Array.take(4),
				Array.map(note => noteRow(h, note, () => picture(h, coverOf(note), 'stash-thumb'), false))
			)
		)
}

function readBody(h: H, raw: string) {
	return Result.match(
		Result.try({catch: Function.identity, try: () => MarkdownParser.parseMarkdown(webLinksOnly(raw))}),
		{
			onFailure: () => h.p.class('stash-plaintext').children(raw),
			onSuccess: document => {
				const points = pipe(
					document.blocks,
					Array.findFirstIndex(
						block =>
							Predicate.isTagged(block, 'Heading') &&
							Array.some(block.content, inline => Predicate.isTagged(inline, 'Text') && inline.value === 'Key points')
					),
					Option.flatMap(index =>
						pipe(
							Array.get(document.blocks, index + 1),
							Option.filter(block => Predicate.isTagged(block, 'List')),
							Option.map(list => ({index, list}))
						)
					),
					Option.getOrUndefined
				)
				if (points === undefined) return prose(h, document)
				const events = pipe(
					points.list.items,
					Array.map(item =>
						pipe(
							Array.head(item.blocks),
							Option.filter(block => Predicate.isTagged(block, 'Paragraph')),
							Option.filter(paragraph => paragraph.content.length === 1 && item.blocks.length === 1),
							Option.flatMap(block => Array.head(block.content)),
							Option.filter(inline => Predicate.isTagged(inline, 'Text')),
							Option.flatMap(inline => String.match(/^(.+?) \((\d{4})\)(.*)$/u)(inline.value)),
							Option.flatMap(capture => {
								const [, title, year, body] = capture
								if (title === undefined || year === undefined || body === undefined) return Option.none()
								return Option.some({body, title, year})
							})
						)
					),
					Option.all,
					Option.getOrUndefined
				)
				if (events === undefined) return prose(h, document, points.list)
				const ordered = Array.sort(
					events,
					Order.mapInput(Order.String, (event: {year: string}) => event.year)
				)
				return [
					h.ol
						.class('stash-points')
						.attr('aria-label', 'Key points')
						.children(
							Array.map(ordered, event =>
								h.li.children(
									h.span.class('stash-year').children(event.year),
									h.p.children(h.strong.children(event.title), event.body)
								)
							)
						),
					prose(h, {blocks: Array.take(document.blocks, points.index)}),
					prose(h, {blocks: Array.drop(document.blocks, points.index + 2)})
				]
			}
		}
	)
}

function denied(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return AsyncResult.isFailure(result) && isDeniedCause(result.cause)
}

export function reader(h: Html.H<Message>, state: Model, note: NoteItem, date: string) {
	if (denied(state.body) || denied(state.media)) {
		return Notice(h, 'Access denied')
	}
	const body = Option.flatMap(AsyncResult.value(state.body), full => full.body)
	const count = Option.getOrElse(AsyncResult.value(state.media), Function.constant(0))
	const pictureFailed = AsyncResult.isFailure(state.media)
	const noteFailed = AsyncResult.isFailure(state.body)
	const notes = Option.getOrElse(AsyncResult.value(state.notes), Array.empty<NoteItem>)
	const related = Array.filter(
		notes,
		item => item.id !== note.id && Array.some(item.tags, tag => Array.contains(note.tags, tag))
	)
	const kind = kindOf(note)
	return h.article.class('stash-reader').children(
		h.div
			.class('stash-meta')
			.children(
				h.span.class('stash-source').attr('data-source', kind).children(kindGlyph(h, kind), sourceLabelOf(note)),
				h.time.class('stash-scale').attr('datetime', DateTime.formatIso(note.createdAt)).children(date)
			),
		h.div.class('stash-title').children(h.h1.children(note.title), gallery(h, note, count)),
		note.status === 'organizing' &&
			h.p
				.class('stash-byline')
				.attr('role', 'status')
				.children(`Reading this ${subjectOf(note)}…`),
		note.status === 'failed' && h.p.class('stash-problem').children(h.span.class('axis-dot'), issueOf(note)),
		String.isNonEmpty(note.summary) && h.p.class('stash-summary').children(note.summary),
		Array.isReadonlyArrayNonEmpty(note.tags) &&
			h.div.class('stash-tags').children(
				Array.map(note.tags, tag =>
					Button(h, {pressed: tag === state.tag})
						.key(tag)
						.on(
							'click',
							Message.FilterTag({tag: Option.getOrUndefined(Option.liftPredicate(tag, name => name !== state.tag))})
						)
						.children(tag, h.small.children(countOf(Array.countBy(notes, item => Array.contains(item.tags, tag)))))
				)
			),
		Option.getOrUndefined(Option.map(body, raw => readBody(h, raw))),
		!AsyncResult.isInitial(state.body) && relatedNotes(h, related),
		(noteFailed || pictureFailed) &&
			h.p
				.class('stash-problem')
				.children(
					h.span.class('axis-dot'),
					Boolean.match(noteFailed, {
						onFalse: Function.constant('Pictures unavailable'),
						onTrue: Function.constant('Note body unavailable')
					}),
					Button(h)
						.class('axis-control stash-action stash-inline-action')
						.on('click', Message.Retry())
						.children('Retry')
				),
		AsyncResult.isInitial(state.body) &&
			note.status === 'ready' &&
			Loading(h, 'Loading note', Placeholder(h, 'stash-body-placeholder'))
	)
}
