import type {Html} from '@effect/ui/html'

import {Record, Schema} from 'effect'

// Monochrome SF Symbols rasterized at 4× from AppKit system images.
const sources = {
	'airplane.arrival': new URL('./symbols/airplane.arrival.png', import.meta.url).href,
	'airplane.departure': new URL('./symbols/airplane.departure.png', import.meta.url).href,
	airplane: new URL('./symbols/airplane.png', import.meta.url).href,
	'arrow.clockwise': new URL('./symbols/arrow.clockwise.png', import.meta.url).href,
	'arrow.counterclockwise': new URL('./symbols/arrow.counterclockwise.png', import.meta.url).href,
	'arrow.triangle.2.circlepath': new URL('./symbols/arrow.triangle.2.circlepath.png', import.meta.url).href,
	'arrow.up.arrow.down': new URL('./symbols/arrow.up.arrow.down.png', import.meta.url).href,
	'arrow.up.right.square': new URL('./symbols/arrow.up.right.square.png', import.meta.url).href,
	bell: new URL('./symbols/bell.png', import.meta.url).href,
	'bell.slash': new URL('./symbols/bell.slash.png', import.meta.url).href,
	bolt: new URL('./symbols/bolt.png', import.meta.url).href,
	book: new URL('./symbols/book.png', import.meta.url).href,
	'books.vertical': new URL('./symbols/books.vertical.png', import.meta.url).href,
	calendar: new URL('./symbols/calendar.png', import.meta.url).href,
	camera: new URL('./symbols/camera.png', import.meta.url).href,
	'chart.bar': new URL('./symbols/chart.bar.png', import.meta.url).href,
	checkmark: new URL('./symbols/checkmark.png', import.meta.url).href,
	'chevron.down': new URL('./symbols/chevron.down.png', import.meta.url).href,
	'chevron.left': new URL('./symbols/chevron.left.png', import.meta.url).href,
	'chevron.right': new URL('./symbols/chevron.right.png', import.meta.url).href,
	clock: new URL('./symbols/clock.png', import.meta.url).href,
	cpu: new URL('./symbols/cpu.png', import.meta.url).href,
	desktopcomputer: new URL('./symbols/desktopcomputer.png', import.meta.url).href,
	'doc.on.clipboard': new URL('./symbols/doc.on.clipboard.png', import.meta.url).href,
	'doc.text': new URL('./symbols/doc.text.png', import.meta.url).href,
	'document.on.clipboard': new URL('./symbols/document.on.clipboard.png', import.meta.url).href,
	'ellipsis.circle': new URL('./symbols/ellipsis.circle.png', import.meta.url).href,
	ellipsis: new URL('./symbols/ellipsis.png', import.meta.url).href,
	'exclamationmark.circle': new URL('./symbols/exclamationmark.circle.png', import.meta.url).href,
	'exclamationmark.triangle': new URL('./symbols/exclamationmark.triangle.png', import.meta.url).href,
	externaldrive: new URL('./symbols/externaldrive.png', import.meta.url).href,
	eye: new URL('./symbols/eye.png', import.meta.url).href,
	'eye.slash': new URL('./symbols/eye.slash.png', import.meta.url).href,
	folder: new URL('./symbols/folder.png', import.meta.url).href,
	gearshape: new URL('./symbols/gearshape.png', import.meta.url).href,
	globe: new URL('./symbols/globe.png', import.meta.url).href,
	'info.circle': new URL('./symbols/info.circle.png', import.meta.url).href,
	iphone: new URL('./symbols/iphone.png', import.meta.url).href,
	key: new URL('./symbols/key.png', import.meta.url).href,
	laptopcomputer: new URL('./symbols/laptopcomputer.png', import.meta.url).href,
	'line.3.horizontal.decrease': new URL('./symbols/line.3.horizontal.decrease.png', import.meta.url).href,
	link: new URL('./symbols/link.png', import.meta.url).href,
	'list.bullet.indent': new URL('./symbols/list.bullet.indent.png', import.meta.url).href,
	'list.bullet': new URL('./symbols/list.bullet.png', import.meta.url).href,
	location: new URL('./symbols/location.png', import.meta.url).href,
	lock: new URL('./symbols/lock.png', import.meta.url).href,
	magnifyingglass: new URL('./symbols/magnifyingglass.png', import.meta.url).href,
	memorychip: new URL('./symbols/memorychip.png', import.meta.url).href,
	network: new URL('./symbols/network.png', import.meta.url).href,
	paperclip: new URL('./symbols/paperclip.png', import.meta.url).href,
	'person.2': new URL('./symbols/person.2.png', import.meta.url).href,
	'person.badge.plus': new URL('./symbols/person.badge.plus.png', import.meta.url).href,
	'person.crop.circle': new URL('./symbols/person.crop.circle.png', import.meta.url).href,
	photo: new URL('./symbols/photo.png', import.meta.url).href,
	pin: new URL('./symbols/pin.png', import.meta.url).href,
	'play.fill': new URL('./symbols/play.fill.png', import.meta.url).href,
	plus: new URL('./symbols/plus.png', import.meta.url).href,
	qrcode: new URL('./symbols/qrcode.png', import.meta.url).href,
	'rectangle.portrait.and.arrow.right': new URL('./symbols/rectangle.portrait.and.arrow.right.png', import.meta.url)
		.href,
	'rectangle.stack': new URL('./symbols/rectangle.stack.png', import.meta.url).href,
	'server.rack': new URL('./symbols/server.rack.png', import.meta.url).href,
	'sidebar.left': new URL('./symbols/sidebar.left.png', import.meta.url).href,
	sparkles: new URL('./symbols/sparkles.png', import.meta.url).href,
	'square.and.arrow.down': new URL('./symbols/square.and.arrow.down.png', import.meta.url).href,
	'square.and.arrow.up': new URL('./symbols/square.and.arrow.up.png', import.meta.url).href,
	'square.and.pencil': new URL('./symbols/square.and.pencil.png', import.meta.url).href,
	'square.stack': new URL('./symbols/square.stack.png', import.meta.url).href,
	'stop.fill': new URL('./symbols/stop.fill.png', import.meta.url).href,
	suitcase: new URL('./symbols/suitcase.png', import.meta.url).href,
	tag: new URL('./symbols/tag.png', import.meta.url).href,
	terminal: new URL('./symbols/terminal.png', import.meta.url).href,
	'text.alignleft': new URL('./symbols/text.alignleft.png', import.meta.url).href,
	ticket: new URL('./symbols/ticket.png', import.meta.url).href,
	'wallet.pass': new URL('./symbols/wallet.pass.png', import.meta.url).href,
	'waveform.path.ecg': new URL('./symbols/waveform.path.ecg.png', import.meta.url).href,
	xmark: new URL('./symbols/xmark.png', import.meta.url).href
}

export type SymbolName = typeof SymbolName.Type
const SymbolName = Schema.Literals(Record.keys(sources))

export function SymbolIcon<M>(h: Html.H<M>, name: SymbolName) {
	return h.span
		.class('sf-symbol')
		.attrs({'aria-hidden': 'true', 'data-symbol': name, style: `--symbol: url("${sources[name]}")`})
}
