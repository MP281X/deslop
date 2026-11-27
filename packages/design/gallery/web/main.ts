import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Layer, Predicate, Schema} from 'effect'

import {DetailText, ListDetail} from '../../src/web/design.ts'
import {detailBody, detailFigure, rows, sheet} from '../data.ts'
import {GalleryRoute, GallerySelection} from '../selection.ts'

const Gallery = Html.component({
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

const root = document.getElementById('root')
if (!Predicate.isNull(root)) {
	Effect.runFork(
		Layer.launch(
			BrowserHost.mount(Gallery, Router.props(GalleryRoute), root).pipe(
				Layer.provide(BrowserRouter.layer({routes: GalleryRoute}))
			)
		)
	)
}
