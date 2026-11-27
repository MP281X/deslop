import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Option} from 'effect'

import type {PaneLeaf} from '@deslop/design/model'
import {Row, status, styles, webStyle} from '@deslop/design/web'

import {boardingSections, flightRowOptions, heroStatus, itineraryContent} from '#screens/board.ts'
import type {BoardingPass, FlightRow, Itinerary} from '#screens/board.ts'
import type {Hero} from '#screens/itinerary.ts'
import type {ScreenParts} from '#screens/trips.ts'

export function control<M>(h: Html.H<M>) {
	return Button(h).class('design-control trips-control').style(webStyle(styles.control))
}

function date<M>(h: Html.H<M>, title: string) {
	return h.p.class('trips-date').style(webStyle(styles.line)).children(title)
}

function figure<M>(h: Html.H<M>, hero: Hero, note?: string) {
	const problem = heroStatus(hero)
	const was = Option.getOrUndefined(hero.was)
	return h.div.class('trips-hero').children(
		h.div
			.style(webStyle(styles.titleLine))
			.children(
				problem !== undefined && h.span.style({...webStyle(styles.dot), backgroundColor: status[problem]}),
				h.span.style(webStyle(styles.line)).children(hero.label)
			),
		h.div.class('trips-hero-figures').children(
			h.span
				.class('trips-hero-value')
				.attr('data-pending', Option.getOrUndefined(Option.liftPredicate('', () => hero.pending)))
				.children(hero.value),
			was !== undefined && h.s.style(webStyle(styles.line)).children(was),
			h.span.class('trips-hero-time').style(webStyle(styles.line)).children(hero.right)
		),
		note !== undefined && h.div.style(webStyle(styles.line)).children(note)
	)
}

function flightRow<M>(h: Html.H<M>, row: FlightRow, parts: ScreenParts, activeId?: string) {
	return Row<M, never>(
		h,
		flightRowOptions(row, parts.selection.select, activeId, (was, current) =>
			h.span.class('trips-time').style(webStyle(styles.line)).children(h.s.children(was), current)
		)
	)
}

export function itineraryRows<M>(h: Html.H<M>, parts: ScreenParts, list: Itinerary, wide: boolean, activeId?: string) {
	return h.div.children(
		...itineraryContent<PaneLeaf<View.Input<M>>>(list, wide, activeId, {
			empty: () =>
				h.div
					.class('trips-notice')
					.children(h.p.children('No upcoming flights'), parts.paste(control(h), 'click').children('Paste booking')),
			group: (title, hero, rows) =>
				h.div.key(title).children(date(h, title), hero !== undefined && figure(h, hero), rows),
			past: row => Row<M, never>(h, {active: false, item: row.item, select: (el, event) => parts.past(el, event)}),
			row: (row, id) => flightRow(h, row, parts, id)
		})
	)
}

export function board<M>(h: Html.H<M>, details: BoardingPass, parts: ScreenParts) {
	return h.div.children(
		parts.halfStep !== undefined &&
			h.div.class('trips-half').children(figure(h, parts.halfStep.hero, Option.getOrUndefined(parts.halfStep.line))),
		h.div
			.class('trips-pass')
			.attr('data-half-step', Option.getOrUndefined(Option.liftPredicate('', () => parts.halfStep !== undefined)))
			.children(
				// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
				h.p.class('trips-context').style(webStyle(styles.line)).children(details.context),
				figure(h, details.hero, details.note),
				...boardingSections(
					details,
					row => flightRow(h, row, parts),
					rows => h.div.class('trips-detail-rows').children(rows),
					(title, rows) => h.div.children(date(h, title), h.div.class('trips-detail-rows').children(rows))
				)
			)
	)
}

export function boardSkeleton<M>(h: Html.H<M>) {
	return h.div
		.class('trips-skeleton-board')
		.attrs({'aria-busy': 'true', 'aria-label': 'Loading boarding pass', role: 'status'})
}
