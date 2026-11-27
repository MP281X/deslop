import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Layer, Schema} from 'effect'

import {DetailText, ListDetail} from '../../src/native/design.ts'
import {detailBody, detailFigure, rows, sheet} from '../data.ts'
import {GalleryRoute, GallerySelection} from '../selection.ts'

const Gallery = Native.component({
	name: 'DesignGallery',
	props: Schema.Struct({route: GalleryRoute}),
	model: Schema.Null,
	message: Schema.Never
}).make({
	init: () => null,
	update: () => null,
	view: h =>
		GallerySelection(h, {
			props: h.props,
			view: selection =>
				ListDetail(h, {
					rows,
					selection,
					sheet,
					detail: row => DetailText(h, row.title, detailBody(row), detailFigure(row))
				})
		})
})

NativeApp.register(
	NativeApp.mount(Gallery, Router.props(GalleryRoute)).pipe(Layer.provide(Router.memory({routes: GalleryRoute})))
)
