import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Layer} from 'effect'

import {detailBody, detailFigure} from '#gallery/data.ts'
import {GalleryRoute, closeReader, dismissSheet, makeGallery, togglePending} from '#gallery/selection.ts'
import {DetailText, Layout, ListDetail, Row, styles} from '#src/native/design.ts'

const Gallery = makeGallery(Native.vocabulary, (h, options) => {
	const label = (text: string) => h.text.style(styles.line).children(text)
	const action = (text: string, onPress: typeof dismissSheet | typeof closeReader | typeof togglePending) =>
		Pressable(h, {onPress, props: {pressedStyle: {backgroundColor: '#2b2b2b'}}})
			.prop('accessible', true)
			.prop('accessibilityRole', 'button')
			.prop('accessibilityLabel', text)
			.on('accessibilityTap', onPress)
			.style(styles.control)
			.children(h.text.style(styles.body).children(text))
	if (options.reader) {
		return Layout(h, {
			content: h.view
				.style({flex: 1, backgroundColor: '#090909', padding: 24})
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
						cover: h.view.style({width: 26, height: 26, borderRadius: 6, backgroundColor: '#202020', flexShrink: 0}),
						trailing: Boolean.match(wide && item.id === 'duo-preview', {
							onFalse: Function.constUndefined,
							onTrue: () =>
								h.view
									.prop('accessibilityLabel', 'Trend')
									.style({flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16})
									.children(
										Array.map([4, 8, 6, 11, 9], (height, index) =>
											h.view.key(`${index}`).style({width: 3, height, backgroundColor: '#aaa'})
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
			body: h.view
				.style({gap: 8})
				.children(
					h.text.style(styles.heading).children('Paste a link'),
					h.text.style(styles.body).children(`Save a URL from the clipboard to ${options.visibility}.`)
				),
			actions: Boolean.match(options.pending, {
				onTrue: () => action('Allow dismissal', togglePending),
				onFalse: () => [action('Hold open', togglePending), action('Done', dismissSheet)]
			})
		}
	})
})

NativeApp.register(
	Layer.provide(NativeApp.mount(Gallery, Router.props(GalleryRoute)), Router.memory({routes: GalleryRoute}))
)
