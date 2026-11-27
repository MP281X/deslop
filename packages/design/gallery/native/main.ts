import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Layer} from 'effect'

import {detailBody, detailFigure} from '#gallery/data.ts'
import {GalleryRoute, makeGallery} from '#gallery/selection.ts'
import {DetailText, ListDetail} from '#src/native/design.ts'

const Gallery = makeGallery(Native.vocabulary, (h, options) =>
	ListDetail(h, {...options, detail: row => DetailText(h, row.title, detailBody(row), detailFigure(row))})
)

NativeApp.register(
	Layer.provide(NativeApp.mount(Gallery, Router.props(GalleryRoute)), Router.memory({routes: GalleryRoute}))
)
