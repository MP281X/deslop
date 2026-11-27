import {BrowserHost, Html} from '@effect/ui/html'

import {Effect, Layer, Predicate, Schema} from 'effect'

import {DetailText, ListDetail} from '../../src/web/design.ts'
import {detailBody, detailFigure, rows, sheet} from '../data.ts'

const Gallery = Html.component({name: 'DesignGallery', model: Schema.Null, message: Schema.Never}).make({
	init: () => null,
	update: () => null,
	view: h => ListDetail(h, {rows, sheet, detail: row => DetailText(h, row.title, detailBody(row), detailFigure(row))})
})

const root = document.getElementById('root')
if (!Predicate.isNull(root)) {
	Effect.runFork(Layer.launch(BrowserHost.mount(Gallery, {}, root)))
}
