import type {Html} from '@effect/ui/html'

import {Record, Schema} from 'effect'

// Monochrome SF Symbols rasterized at 4× from AppKit system images.
const sources = {
	airplane: new URL('./symbols/airplane.png', import.meta.url).href,
	'airplane.arrival': new URL('./symbols/airplane.arrival.png', import.meta.url).href,
	'airplane.departure': new URL('./symbols/airplane.departure.png', import.meta.url).href,
	'arrow.clockwise': new URL('./symbols/arrow.clockwise.png', import.meta.url).href,
	'books.vertical': new URL('./symbols/books.vertical.png', import.meta.url).href,
	checkmark: new URL('./symbols/checkmark.png', import.meta.url).href,
	'chevron.down': new URL('./symbols/chevron.down.png', import.meta.url).href,
	'chevron.left': new URL('./symbols/chevron.left.png', import.meta.url).href,
	'chevron.right': new URL('./symbols/chevron.right.png', import.meta.url).href,
	clock: new URL('./symbols/clock.png', import.meta.url).href,
	cpu: new URL('./symbols/cpu.png', import.meta.url).href,
	'doc.on.clipboard': new URL('./symbols/doc.on.clipboard.png', import.meta.url).href,
	'doc.text': new URL('./symbols/doc.text.png', import.meta.url).href,
	'document.on.clipboard': new URL('./symbols/document.on.clipboard.png', import.meta.url).href,
	ellipsis: new URL('./symbols/ellipsis.png', import.meta.url).href,
	'exclamationmark.circle': new URL('./symbols/exclamationmark.circle.png', import.meta.url).href,
	'line.3.horizontal.decrease': new URL('./symbols/line.3.horizontal.decrease.png', import.meta.url).href,
	link: new URL('./symbols/link.png', import.meta.url).href,
	location: new URL('./symbols/location.png', import.meta.url).href,
	paperclip: new URL('./symbols/paperclip.png', import.meta.url).href,
	photo: new URL('./symbols/photo.png', import.meta.url).href,
	'play.fill': new URL('./symbols/play.fill.png', import.meta.url).href,
	plus: new URL('./symbols/plus.png', import.meta.url).href,
	'rectangle.portrait.and.arrow.right': new URL('./symbols/rectangle.portrait.and.arrow.right.png', import.meta.url)
		.href,
	'sidebar.left': new URL('./symbols/sidebar.left.png', import.meta.url).href,
	'square.and.arrow.up': new URL('./symbols/square.and.arrow.up.png', import.meta.url).href,
	'square.and.pencil': new URL('./symbols/square.and.pencil.png', import.meta.url).href,
	'square.stack': new URL('./symbols/square.stack.png', import.meta.url).href,
	'stop.fill': new URL('./symbols/stop.fill.png', import.meta.url).href,
	ticket: new URL('./symbols/ticket.png', import.meta.url).href,
	xmark: new URL('./symbols/xmark.png', import.meta.url).href
}

export type SymbolName = typeof SymbolName.Type
const SymbolName = Schema.Literals(Record.keys(sources))

export function SymbolIcon<M>(h: Html.H<M>, name: SymbolName) {
	return h.span
		.class('sf-symbol')
		.attrs({'aria-hidden': 'true', 'data-symbol': name, style: `--symbol: url("${sources[name]}")`})
}
