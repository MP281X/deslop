import {Native, NativeApp} from '@effect/ui-native'

import {Schema} from 'effect'

import {DetailText, ListDetail} from '../../src/native/design.ts'
import {detailBody, detailFigure, rows, sheet} from '../data.ts'

const Gallery = Native.component({name: 'DesignGallery', model: Schema.Null, message: Schema.Never}).make({
	init: () => null,
	update: () => null,
	view: h => ListDetail(h, {rows, sheet, detail: row => DetailText(h, row.title, detailBody(row), detailFigure(row))})
})

NativeApp.register(NativeApp.mount(Gallery, {}))
