import {Mount} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Queue, Schema, Stream} from 'effect'

import {ink, styles, webStyle} from '@deslop/components/web'

import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {pageAspect} from '#screens/reading.ts'

const Shape = Mount.makeStream('Opm/PageShape', {args: {src: Schema.String}}, (node: HTMLImageElement, page) =>
	Stream.callback<Message>(queue =>
		Effect.acquireRelease(
			Effect.sync(() => {
				function loaded() {
					Queue.offerUnsafe(
						queue,
						Message.Image({aspect: pageAspect(node.naturalWidth, node.naturalHeight), src: page.src})
					)
				}
				node.addEventListener('load', loaded)
				node.addEventListener('error', loaded)
				if (node.complete) loaded()
				return () => {
					node.removeEventListener('load', loaded)
					node.removeEventListener('error', loaded)
				}
			}),
			remove => Effect.sync(remove)
		)
	)
)

function pageImage(h: Html.H<Message>, page: Screen['pages'][number]) {
	if (page.failed) {
		return Button(h)
			.class('design-control opm-retry-page')
			.style({...webStyle(styles.control), border: '0', color: ink})
			.on('pointerdown', Function.constUndefined)
			.on('click', Message.RetryPage({src: page.src}))
			.children('Reload page')
	}
	return h.img
		.attrs({alt: `Page ${page.index + 1}`, draggable: 'false', referrerpolicy: 'no-referrer', src: page.src})
		.onMount(Shape({src: page.src}))
}

export function WebReader(h: Html.H<Message>, reader: NonNullable<Screen['reader']>, pages: Screen['pages']) {
	function pending() {
		if (reader.ready) return undefined
		if (!reader.waiting) return h.p.style(webStyle(styles.line)).attr('role', 'status').children('Chapter unavailable')
		return h.div
			.class('opm-page-placeholder')
			.attrs({'aria-busy': 'true', 'aria-label': 'Loading chapter', role: 'status'})
	}
	return h.section
		.key(reader.id)
		.class('opm-reader design-detail')
		.attr('aria-label', reader.title)
		.on(
			'pointerdown',
			press => {
				if (press.button !== 0) return undefined
				return Message.PointerDown({pointerId: press.pointerId, x: press.x, y: press.y})
			},
			{capturePointer: true}
		)
		.on('pointerup', release => Message.PointerUp({pointerId: release.pointerId, x: release.x, y: release.y}))
		.on('pointercancel', cancel => Message.PointerCancel({pointerId: cancel.pointerId}))
		.children(
			pending(),
			h.div.class('opm-paper').children(
				Array.map(pages, page =>
					h.div
						.key(`${page.index}`)
						.class('opm-leaf')
						.attrs({
							'data-side': page.side,
							hidden: Boolean.match(page.visible, {onFalse: Function.constant(''), onTrue: Function.constUndefined})
						})
						.children(pageImage(h, page))
				)
			)
		)
}
