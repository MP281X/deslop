import type {Native} from '@effect/ui-native'

import {Array, Boolean, Function, Option} from 'effect'

import type {PaneLeaf} from '@deslop/design/model'
import {Row, status, nativeControls, styles} from '@deslop/design/native'

import {PAST, boardingSections, flightRowOptions, heroStatus, itineraryContent} from '#screens/board.ts'
import type {BoardingPass, FlightRow, Itinerary} from '#screens/board.ts'
import type {Hero} from '#screens/itinerary.ts'
import type {ScreenParts} from '#screens/trips.ts'

const FIGURES = ['tabular-nums'] as const

export const control = nativeControls({disabledOpacity: 0.55}).Button
function date<M>(h: Native.H<M>, title: string) {
	return h.text
		.style({...styles.line, fontWeight: '600', paddingBottom: 4, paddingHorizontal: 12, paddingTop: 12})
		.children(title)
}

function figure<M>(h: Native.H<M>, hero: Hero, note?: string, inset = 0) {
	const problem = heroStatus(hero)
	const was = Option.getOrUndefined(hero.was)
	return h.view
		.style({paddingBottom: 20, paddingHorizontal: inset, paddingTop: 12})
		.children(
			h.view
				.style(styles.titleLine)
				.children(
					problem !== undefined && h.view.style({...styles.dot, backgroundColor: status[problem]}),
					h.text.style(styles.line).children(hero.label)
				),
			h.view
				.style({alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 8})
				.children(
					h.text
						.style({
							...styles.heading,
							fontSize: 34,
							fontVariant: FIGURES,
							lineHeight: 40,
							opacity: Boolean.match(hero.pending, {onFalse: Function.constant(1), onTrue: Function.constant(0.55)})
						})
						.children(hero.value),
					was !== undefined &&
						h.text.style({...styles.line, fontVariant: FIGURES, textDecorationLine: 'line-through'}).children(was),
					h.text.style({...styles.line, flex: 1, textAlign: 'right'}).children(hero.right)
				),
			note !== undefined && h.text.style(styles.line).children(note)
		)
}

function flightRow<M>(h: Native.H<M>, row: FlightRow, parts: ScreenParts, activeId?: string) {
	return Row<M, never>(
		h,
		flightRowOptions(row, parts.selection.select, activeId, (was, current) =>
			h.view
				.style({flexDirection: 'row', gap: 6})
				.children(
					h.text.style({...styles.line, fontVariant: FIGURES, textDecorationLine: 'line-through'}).children(was),
					h.text.style({...styles.line, fontVariant: FIGURES}).children(current)
				)
		)
	)
}

export function itineraryRows<M>(
	h: Native.H<M>,
	parts: ScreenParts,
	list: Itinerary,
	wide: boolean,
	activeId?: string
) {
	return h.view.children(
		...itineraryContent<PaneLeaf<Native.NoTextInput<M>>>(list, wide, activeId, {
			empty: () =>
				h.view
					.style({alignItems: 'flex-start', gap: 8, padding: 16})
					.children(
						h.text.style(styles.body).children('No upcoming flights'),
						control(h, parts.paste(parts.paste(h.view, 'press'), 'accessibilityTap'), 'Paste booking')
					),
			group: (title, hero, rows) =>
				h.view.key(title).children(date(h, title), hero !== undefined && figure(h, hero, undefined, 12), rows),
			past: row =>
				Row<M, never>(h, {
					active: false,
					item: row.item,
					select: (el, event) => parts.selection.select(el, event, PAST)
				}),
			row: (row, id) => flightRow(h, row, parts, id)
		})
	)
}

export function board<M>(h: Native.H<M>, details: BoardingPass, parts: ScreenParts) {
	return h.view.children(
		// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
		h.text.style({...styles.line, fontFamily: 'ui-monospace', fontVariant: FIGURES}).children(details.context),
		figure(h, details.hero, details.note),
		...boardingSections(
			details,
			row => flightRow(h, row, parts),
			rows => h.view.style({marginHorizontal: -12}).children(rows),
			(title, rows) => h.view.style({marginHorizontal: -12}).children(date(h, title), rows)
		)
	)
}

export function boardSkeleton<M>(h: Native.H<M>) {
	function block(width: Native.ViewStyle['width'], height: number) {
		return h.view.style({backgroundColor: '#202020', borderRadius: 4, height, width})
	}
	return h.view.prop('accessibilityLabel', 'Loading boarding pass').children(
		block('44%', 10),
		h.view.style({gap: 8, paddingVertical: 20}).children(block(35, 10), block(72, 25)),
		Array.makeBy(3, index =>
			h.view
				.key(`skeleton-${index}`)
				.style({gap: 6, height: 54, justifyContent: 'center'})
				.children(block(64, 12), block(112, 10))
		)
	)
}
