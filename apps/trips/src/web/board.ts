import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Array, Option} from 'effect'

import {Row, status, styles, webStyle} from '@deslop/design/web'

import type {BoardingPass, FlightRow, Itinerary} from '#screens/board.ts'
import {PAST} from '#screens/board.ts'
import type {Hero} from '#screens/itinerary.ts'
import type {ScreenParts} from '#screens/trips.ts'

export function control<M>(h: Html.H<M>) {
	return Button(h).class('design-control trips-control').style(webStyle(styles.control))
}

function date<M>(h: Html.H<M>, title: string) {
	return h.p.class('trips-date').style(webStyle(styles.line)).children(title)
}

function figure<M>(h: Html.H<M>, hero: Hero, note?: string) {
	const problem = Option.getOrUndefined(hero.problem)
	const was = Option.getOrUndefined(hero.was)
	return h.div.class('trips-hero').children(
		h.div
			.style(webStyle(styles.titleLine))
			.children(
				problem !== undefined &&
					h.span.style({...webStyle(styles.dot), backgroundColor: status[problem === 'bad' ? 'error' : 'warning']}),
				h.span.style(webStyle(styles.line)).children(hero.label)
			),
		h.div.class('trips-hero-figures').children(
			h.span
				.class('trips-hero-value')
				.attr('data-pending', hero.pending ? '' : undefined)
				.children(hero.value),
			was !== undefined && h.s.style(webStyle(styles.line)).children(was),
			h.span.class('trips-hero-time').style(webStyle(styles.line)).children(hero.right)
		),
		note !== undefined && h.div.style(webStyle(styles.line)).children(note)
	)
}

function flightRow<M>(h: Html.H<M>, row: FlightRow, parts: ScreenParts, activeId?: string) {
	const target = row.target
	return Row(h, {
		active: target !== undefined && target === activeId,
		item: row.item,
		...(target !== undefined && {select: (el, event) => parts.selection.select(el, event, target)}),
		trailing:
			row.was === undefined
				? undefined
				: h.span.class('trips-time').style(webStyle(styles.line)).children(h.s.children(row.was), row.item.trailing)
	})
}

export function itineraryRows<M>(
	h: Html.H<M>,
	parts: ScreenParts,
	list: Itinerary,
	activeId: string | undefined,
	wide: boolean
) {
	return h.div.children(
		Array.isReadonlyArrayEmpty(list.compact) &&
			h.div
				.class('trips-notice')
				.children(h.p.children('No upcoming flights'), parts.paste(control(h), 'click').children('Paste booking')),
		Array.map(wide ? list.timeline : list.compact, (group, index) =>
			h.div.key(group.date).children(
				date(h, group.date),
				!wide && index === 0 && list.hero !== undefined && figure(h, list.hero),
				Array.map(group.rows, row => flightRow(h, row, parts, activeId))
			)
		),
		list.airport !== undefined && flightRow(h, list.airport, parts),
		list.past !== undefined &&
			Row(h, {
				active: false,
				item: list.past.item,
				select: (el, event) => parts.selection.select(el.attr('aria-expanded', `${list.pastOpen}`), event, PAST)
			}),
		Array.map(list.pastRows, row => flightRow(h, row, parts, activeId))
	)
}

export function board<M>(h: Html.H<M>, details: BoardingPass, parts: ScreenParts) {
	const half = parts.halfStep
	return h.div.children(
		half !== undefined && h.div.class('trips-half').children(figure(h, half.hero, Option.getOrUndefined(half.line))),
		h.div
			.class('trips-pass')
			.attr('data-half-step', half === undefined ? undefined : '')
			.children(
				h.p.class('trips-context').style(webStyle(styles.line)).children(details.context),
				figure(h, details.hero, details.note),
				h.div.class('trips-detail-rows').children(Array.map(details.rows, row => flightRow(h, row, parts))),
				Array.isReadonlyArrayNonEmpty(details.travellers) &&
					h.div.children(
						date(h, 'Travellers'),
						h.div.class('trips-detail-rows').children(Array.map(details.travellers, row => flightRow(h, row, parts)))
					)
			)
	)
}

export function boardSkeleton<M>(h: Html.H<M>) {
	return h.div
		.class('trips-skeleton-board')
		.attrs({'aria-label': 'Loading boarding pass', 'aria-busy': 'true', role: 'status'})
}
