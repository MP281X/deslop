import {Router} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Boolean, Function, Effect, Layer, Predicate, pipe} from 'effect'

import {detailBody, detailFigure} from '#gallery/data.ts'
import {GalleryRoute, closeReader, dismissSheet, makeGallery, togglePending} from '#gallery/selection.ts'
import {DetailText, Layout, ListDetail, Row, styles, webStyle} from '#src/web/design.ts'

const Gallery = makeGallery(Html.vocabulary, (h, options) => {
	const label = (text: string) => h.div.style(webStyle(styles.line)).children(text)
	const action = (text: string, onPress: typeof dismissSheet | typeof closeReader | typeof togglePending) =>
		Button(h, {onPress})
			.style({...webStyle(styles.control), color: styles.title.color, border: '0'})
			.children(text)
	if (options.reader) {
		return Layout(h, {
			content: h.div
				.style({flex: '1', backgroundColor: '#090909', padding: '24px', boxSizing: 'border-box'})
				.children(
					DetailText(h, 'Reader', 'The app draws this edge-to-edge screen.', '1 / 1'),
					action('Close reader', closeReader)
				)
		})
	}
	const selected = options.selected
	return ListDetail(h, {
		defaultId: options.defaultId,
		loading: options.loading,
		selection: options.selection,
		toolbar: options.toolbar,
		detailToolbar: options.detailToolbar,
		header: label('On this worker'),
		empty: label('No matching services'),
		list: Boolean.match(options.rows.length === 0, {
			onTrue: Function.constUndefined,
			onFalse: () => (activeId: string | undefined, wide: boolean) => [
				label('Today'),
				Array.map(options.rows, item =>
					Row(h, {
						item,
						active: activeId === item.id,
						muted: item.id === 't3',
						select: options.selection.select,
						cover: h.span
							.attr('aria-hidden', 'true')
							.style({width: '26px', height: '26px', borderRadius: '6px', backgroundColor: '#202020', flexShrink: '0'}),
						trailing: Boolean.match(wide && item.id === 'duo-preview', {
							onFalse: Function.constUndefined,
							onTrue: () =>
								h.span
									.attr('aria-label', 'Trend')
									.style({display: 'flex', alignItems: 'end', gap: '2px', height: '16px'})
									.children(
										Array.map([4, 8, 6, 11, 9], (height, index) =>
											h.span.key(`${index}`).style({width: '3px', height: `${height}px`, backgroundColor: '#aaa'})
										)
									)
						})
					})
				)
			]
		}),
		detail: (() => {
			if (options.loading || options.listOnly) return undefined
			if (selected === undefined)
				return DetailText(h, 'Worker', 'Machine overview stays beside the list.', '13 services')
			return [DetailText(h, selected.title, detailBody(selected), detailFigure(selected))]
		})(),
		sheet: {
			open: options.sheetOpen,
			label: 'Paste a link',
			height: 0.42,
			dismiss: options.dismiss,
			toolbar: options.sheetToolbar,
			pending: options.pending,
			body: h.div.children(
				h.h2.style(webStyle(styles.heading)).children('Paste a link'),
				h.p.style(webStyle(styles.body)).children(`Save a URL from the clipboard to ${options.visibility}.`)
			),
			actions: Boolean.match(options.pending, {
				onTrue: () => action('Allow dismissal', togglePending),
				onFalse: () => [action('Hold open', togglePending), action('Done', dismissSheet)]
			})
		}
	})
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
