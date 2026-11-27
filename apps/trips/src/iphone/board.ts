import type {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Option} from 'effect'

import {Row, status, styles} from '@deslop/design/native'

import {PAST} from '#screens/board.ts'
import type {BoardingPass, FlightRow, Itinerary} from '#screens/board.ts'
import type {Hero} from '#screens/itinerary.ts'
import type {ScreenParts} from '#screens/trips.ts'

const FIGURES = ['tabular-nums'] as const

export function control<M>(
	h: Native.H<M>,
	element: Native.ViewElement<M, never, Native.ViewEvents, 'view'>,
	label: string,
	disabled = false
) {
	return Pressable(h, {element, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.style({...styles.control, opacity: disabled ? 0.55 : 1})
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled})
		.prop('accessible', true)
		.children(h.text.style(styles.body).children(label))
}

function date<M>(h: Native.H<M>, title: string) {
	return h.text
		.style({...styles.line, fontWeight: '600', paddingBottom: 4, paddingHorizontal: 12, paddingTop: 12})
		.children(title)
}

function figure<M>(h: Native.H<M>, hero: Hero, note?: string, inset = 0) {
	const problem = Option.getOrUndefined(hero.problem)
	const was = Option.getOrUndefined(hero.was)
	return h.view
		.style({paddingBottom: 20, paddingHorizontal: inset, paddingTop: 12})
		.children(
			h.view
				.style(styles.titleLine)
				.children(
					problem !== undefined &&
						h.view.style({...styles.dot, backgroundColor: status[problem === 'bad' ? 'error' : 'warning']}),
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
							opacity: hero.pending ? 0.55 : 1
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
	const target = row.target
	return Row(h, {
		active: target !== undefined && target === activeId,
		item: row.item,
		...(target !== undefined && {select: (el, event) => parts.selection.select(el, event, target)}),
		trailing:
			row.was === undefined
				? undefined
				: h.view
						.style({flexDirection: 'row', gap: 6})
						.children(
							h.text
								.style({...styles.line, fontVariant: FIGURES, textDecorationLine: 'line-through'})
								.children(row.was),
							h.text.style({...styles.line, fontVariant: FIGURES}).children(row.item.trailing)
						)
	})
}

export function itineraryRows<M>(
	h: Native.H<M>,
	parts: ScreenParts,
	list: Itinerary,
	activeId: string | undefined,
	wide: boolean
) {
	return h.view.children(
		Array.isReadonlyArrayEmpty(list.compact) &&
			h.view
				.style({alignItems: 'flex-start', gap: 8, padding: 16})
				.children(
					h.text.style(styles.body).children('No upcoming flights'),
					control(h, parts.paste(parts.paste(h.view, 'press'), 'accessibilityTap'), 'Paste booking')
				),
		Array.map(wide ? list.timeline : list.compact, (group, index) =>
			h.view.key(group.date).children(
				date(h, group.date),
				!wide && index === 0 && list.hero !== undefined && figure(h, list.hero, undefined, 12),
				Array.map(group.rows, row => flightRow(h, row, parts, activeId))
			)
		),
		list.airport !== undefined && flightRow(h, list.airport, parts),
		list.past !== undefined &&
			Row(h, {active: false, item: list.past.item, select: (el, event) => parts.selection.select(el, event, PAST)}),
		Array.map(list.pastRows, row => flightRow(h, row, parts, activeId))
	)
}

export function board<M>(h: Native.H<M>, details: BoardingPass, parts: ScreenParts) {
	return h.view.children(
		h.text.style({...styles.line, fontFamily: 'ui-monospace', fontVariant: FIGURES}).children(details.context),
		figure(h, details.hero, details.note),
		h.view.style({marginHorizontal: -12}).children(Array.map(details.rows, row => flightRow(h, row, parts))),
		Array.isReadonlyArrayNonEmpty(details.travellers) &&
			h.view.style({marginHorizontal: -12}).children(
				date(h, 'Travellers'),
				Array.map(details.travellers, row => flightRow(h, row, parts))
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
