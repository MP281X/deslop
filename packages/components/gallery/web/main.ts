import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Effect, Layer, Predicate, pipe} from 'effect'

import {renderGallery} from '#gallery/list.ts'
import {GalleryRoute, makeGallery} from '#gallery/selection.ts'
import type {GalleryMessage, dismissSheet, togglePending, closeReader} from '#gallery/selection.ts'
import type {PaneLeaf} from '#src/shared/model.ts'
import {DetailText, Layout, ListDetail, Row, styles, webStyle} from '#src/web/design.ts'

const Gallery = makeGallery(Html.vocabulary, (h, options) => {
	function label(text: string) {
		return h.div.style(webStyle(styles.line)).children(text)
	}
	function action(text: string, onPress: typeof dismissSheet | typeof closeReader | typeof togglePending) {
		return Button(h, {onPress})
			.style({...webStyle(styles.control), border: '0', color: styles.title.color})
			.children(text)
	}
	return renderGallery<typeof h, PaneLeaf<View.Input<GalleryMessage>>, View.Content<GalleryMessage>>(
		h,
		options,
		{DetailText, Layout, ListDetail, Row},
		{
			action,
			cover: () =>
				h.span
					.attr('aria-hidden', 'true')
					.style({backgroundColor: '#202020', borderRadius: '6px', flexShrink: '0', height: '26px', width: '26px'}),
			label,
			reader: (detail, closer) =>
				h.div
					.style({backgroundColor: '#090909', boxSizing: 'border-box', flex: '1', padding: '24px'})
					.children(detail, closer),
			sheetBody: () =>
				h.div.children(
					h.h2.style(webStyle(styles.heading)).children('Paste a link'),
					h.p.style(webStyle(styles.body)).children(`Save a URL from the clipboard to ${options.visibility}.`)
				),
			trend: () =>
				h.span
					.attr('aria-label', 'Trend')
					.style({alignItems: 'end', display: 'flex', gap: '2px', height: '16px'})
					.children(
						Array.map([4, 8, 6, 11, 9], (height, index) =>
							h.span.key(`${index}`).style({backgroundColor: '#aaa', height: `${height}px`, width: '3px'})
						)
					)
		}
	)
})

const root = document.getElementById('root')
if (!Predicate.isNull(root)) {
	pipe(
		BrowserHost.mount(Gallery, Router.props(GalleryRoute), root),
		Layer.provide(BrowserRouter.layer({routes: GalleryRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns the page-lifetime scope.
		Effect.runFork
	)
}
