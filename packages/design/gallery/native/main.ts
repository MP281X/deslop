import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Layer} from 'effect'

import {renderGallery} from '#gallery/list.ts'
import type {GalleryMessage, dismissSheet, togglePending, closeReader} from '#gallery/selection.ts'
import {GalleryRoute, makeGallery} from '#gallery/selection.ts'
import {DetailText, Layout, ListDetail, Row, styles} from '#src/native/design.ts'
import type {PaneLeaf} from '#src/shared/model.ts'

const Gallery = makeGallery(Native.vocabulary, (h, options) => {
	function label(text: string) {
		return h.text.style(styles.line).children(text)
	}
	function action(text: string, onPress: typeof dismissSheet | typeof closeReader | typeof togglePending) {
		return Pressable(h, {onPress, props: {pressedStyle: {backgroundColor: '#2b2b2b'}}})
			.prop('accessible', true)
			.prop('accessibilityRole', 'button')
			.prop('accessibilityLabel', text)
			.on('accessibilityTap', onPress)
			.style(styles.control)
			.children(h.text.style(styles.body).children(text))
	}
	return renderGallery<typeof h, PaneLeaf<Native.NoTextInput<GalleryMessage>>, View.Content<GalleryMessage>>(
		h,
		options,
		{DetailText, Layout, ListDetail, Row},
		{
			action,
			cover: () => h.view.style({backgroundColor: '#202020', borderRadius: 6, flexShrink: 0, height: 26, width: 26}),
			label,
			reader: (detail, closer) =>
				h.view.style({backgroundColor: '#090909', flex: 1, padding: 24}).children(detail, closer),
			sheetBody: () =>
				h.view
					.style({gap: 8})
					.children(
						h.text.style(styles.heading).children('Paste a link'),
						h.text.style(styles.body).children(`Save a URL from the clipboard to ${options.visibility}.`)
					),
			trend: () =>
				h.view
					.prop('accessibilityLabel', 'Trend')
					.style({alignItems: 'flex-end', flexDirection: 'row', gap: 2, height: 16})
					.children(
						Array.map([4, 8, 6, 11, 9], (height, index) =>
							h.view.key(`${index}`).style({backgroundColor: '#aaa', height, width: 3})
						)
					)
		}
	)
})

NativeApp.register(
	Layer.provide(NativeApp.mount(Gallery, Router.props(GalleryRoute)), Router.memory({routes: GalleryRoute}))
)
