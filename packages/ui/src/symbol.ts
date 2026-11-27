import type {Html} from '@effect/ui/html'

import {Record, Schema} from 'effect'

// Monochrome SF Symbols rasterized at 4× from AppKit system images.
const sources = {
	checkmark: new URL('./symbols/checkmark.png', import.meta.url).href,
	'chevron.left': new URL('./symbols/chevron.left.png', import.meta.url).href,
	ellipsis: new URL('./symbols/ellipsis.png', import.meta.url).href,
	'line.3.horizontal.decrease': new URL('./symbols/line.3.horizontal.decrease.png', import.meta.url).href,
	plus: new URL('./symbols/plus.png', import.meta.url).href,
	'sidebar.left': new URL('./symbols/sidebar.left.png', import.meta.url).href,
	'square.and.arrow.up': new URL('./symbols/square.and.arrow.up.png', import.meta.url).href,
	'square.and.pencil': new URL('./symbols/square.and.pencil.png', import.meta.url).href,
	xmark: new URL('./symbols/xmark.png', import.meta.url).href
}

export type SymbolName = typeof SymbolName.Type
const SymbolName = Schema.Literals(Record.keys(sources))

export function SymbolIcon<M>(h: Html.H<M>, name: SymbolName) {
	return h.span
		.class('sf-symbol')
		.attrs({'aria-hidden': 'true', 'data-symbol': name, style: `--symbol: url("${sources[name]}")`})
}
