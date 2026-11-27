import {Button} from '@effect/ui-kit'
import {Markdown} from '@effect/ui/html'
import type {Html} from '@effect/ui/html'

import {Array, Result, String} from 'effect'

import {Row, styles, webStyle} from '@deslop/design/web'

import type {TagName} from '#contracts'

import {isWebLink, parseBody} from '#screens/note.ts'
import type {Reader, StashMessage, StashScreen} from '#screens/notes.ts'
import {retry} from '#screens/notes.ts'

type H = Html.H<StashMessage>

function body(h: H, raw: string) {
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

function sourceIcon(h: H, note: Reader) {
	if (note.kind === 'file' || note.kind === 'note' || note.kind === 'web') return undefined
	return h.img.class('stash-source-logo').attrs({alt: '', src: logos[note.kind]})
}

export function TagButton(h: Html.H<StashMessage>, screen: StashScreen, tag: TagName, count?: number) {
	return Button(h, {onPress: screen.filter(tag)})
		.key(tag)
		.attr('aria-pressed', `${screen.tag === tag}`)
		.children(tag, count !== undefined && h.small.children(`${count}`))
}

export function Skeleton(h: Html.H<StashMessage>) {
	return h.div
		.class('stash-body-skeleton')
		.attrs({'aria-label': 'Loading note', role: 'status'})
		.children(h.div, h.div, h.div, h.div)
}

export function ReaderView(h: Html.H<StashMessage>, screen: StashScreen, note: Reader) {
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
				.children(
					h.span.class('stash-error-dot'),
					note.retry,
					Button(h, {onPress: retry}).class('stash-button').children('Retry')
				),
		!note.loading &&
			Array.isReadonlyArrayNonEmpty(note.related) &&
			h.section
				.class('stash-related')
				.attr('aria-label', 'Related notes')
				.children(
					h.p.style(webStyle(styles.line)).children('Related notes'),
					Array.map(note.related, item =>
						Row<StashMessage, never>(h, {active: false, item, select: screen.selection.select})
					)
				)
	)
}
