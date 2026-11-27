import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {detailBody, detailFigure} from '#gallery/data.ts'
import {GalleryRoute, makeGallery} from '#gallery/selection.ts'
import {DetailText, ListDetail} from '#src/web/design.ts'

const Gallery = makeGallery(Html.vocabulary, (h, options) =>
	ListDetail(h, {...options, detail: row => DetailText(h, row.title, detailBody(row), detailFigure(row))})
)

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
