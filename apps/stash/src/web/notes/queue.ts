import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Duration, Function, Match, Number, Option, String, pipe} from 'effect'

import {ageOf, countOf, dayOf} from '@deslop/runtime/shared/format'
import {Row} from '@deslop/ui/axis'
import {SymbolIcon} from '@deslop/ui/symbol'

import type {Kind, NoteItem} from '#contracts'

import {kindOf, kinds, sourceLabelOf, subjectOf} from '#web/notes/kinds.ts'
import {Message} from '#web/notes/model.ts'

const SOURCES = ['x', 'tiktok', 'youtube', 'web', 'note', 'file'] as const

const LOGOS = {
	tiktok: new URL('../assets/tiktok.svg', import.meta.url).href,
	x: new URL('../assets/x.svg', import.meta.url).href,
	youtube: new URL('../assets/youtube.svg', import.meta.url).href
}

export function kindGlyph(h: Html.H<Message>, kind: Kind) {
	return pipe(
		Match.value(kind),
		Match.when('file', () => SymbolIcon(h, 'photo')),
		Match.when('note', () => SymbolIcon(h, 'doc.text')),
		Match.when('web', () => SymbolIcon(h, 'link')),
		Match.whenOr('tiktok', 'x', 'youtube', source => h.img.class('stash-logo').attrs({alt: '', src: LOGOS[source]})),
		Match.exhaustive
	)
}

function saved(at: DateTime.Utc, now: DateTime.Utc) {
	if (pipe(at, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		const age = ageOf(at, now)
		const [value, unit] = String.split(age, /(?<=[0-9])(?=[hm])/u)
		if (unit === undefined) return {axis: age, label: age, unit: '', value}
		return {axis: age, label: `${age} ago`, unit: `${unit} ago`, value}
	}
	const label = dayOf(at, now)
	const [value] = String.split(label, ' ')
	return {axis: value, label, unit: String.slice(value.length + 1)(label), value}
}

export function savedOf(note: NoteItem, now: DateTime.Utc) {
	return saved(note.createdAt, now).label
}

export function issueOf(note: NoteItem) {
	return Option.getOrElse(note.issue, () => `Couldn’t read this ${subjectOf(note)}`)
}

function lineOf(note: NoteItem) {
	if (note.status === 'failed') return issueOf(note)
	if (note.status === 'organizing') return `Reading this ${subjectOf(note)}`
	return pipe(
		[sourceLabelOf(note), Option.getOrElse(Array.head(note.tags), Function.constant(''))],
		Array.filter(String.isNonEmpty),
		Array.join(' · ')
	)
}

export function noteRow(h: Html.H<Message>, note: NoteItem, cover: () => View.Content<Message>, current: boolean) {
	const kind = kindOf(note)
	return Row(h, {
		className: 'stash-note-row',
		current,
		id: note.id,
		leading: Option.match(note.image, {
			onNone: () => h.span.class('stash-stamp').attr('data-source', kind).children(kindGlyph(h, kind)),
			onSome: cover
		}),
		line: lineOf(note),
		open: Message.Open({id: note.id}),
		problem: note.status === 'failed',
		title: note.title
	})
}

function savesPlot(
	h: Html.H<Message>,
	now: DateTime.Utc,
	groups: Array.NonEmptyReadonlyArray<Array.NonEmptyReadonlyArray<NoteItem>>
) {
	const recent = Array.reverse(Array.splitAtNonEmpty(groups, 8)[0])
	const total = Number.sumAll(Array.map(recent, entries => entries.length))
	const largest = Array.reduce(recent, 1, (max, entries) => Number.max(max, entries.length))
	const legend = Array.filter(SOURCES, kind =>
		Array.some(recent, entries => Array.some(entries, note => kindOf(note) === kind))
	)
	const first = savedOf(Array.headNonEmpty(Array.headNonEmpty(recent)), now)
	const last = savedOf(Array.headNonEmpty(Array.lastNonEmpty(recent)), now)
	return h.figure
		.class('stash-plot')
		.attr('aria-label', 'Saves by date and source')
		.children(
			h.figcaption
				.class('stash-meta')
				.children(
					h.strong
						.class('stash-save-count')
						.children(
							countOf(total),
							h.small.children(
								Boolean.match(total === 1, {onFalse: Function.constant(' saves'), onTrue: Function.constant(' save')})
							)
						),
					h.span
						.class('stash-scale')
						.children(
							Boolean.match(first === last, {onFalse: () => `${first} – ${last}`, onTrue: Function.constant(last)})
						)
				),
			h.div
				.class('stash-bins')
				.attr('style', `--stash-bins: ${recent.length}`)
				.children(
					Array.map(recent, entries => {
						const date = saved(Array.headNonEmpty(entries).createdAt, now)
						const sources = Array.flatMap(legend, kind => {
							const count = Array.countBy(entries, note => kindOf(note) === kind)
							if (count === 0) return []
							return [{count, kind}]
						})
						return h.div
							.key(date.label)
							.class('stash-bin')
							.children(
								h.div
									.class('stash-stack')
									.attrs({
										'aria-label': `${date.label}: ${pipe(
											sources,
											Array.map(source => `${source.count} ${kinds[source.kind]}`),
											Array.join(', ')
										)}`,
										role: 'img'
									})
									.children(
										Array.flatMap(sources, source => {
											function bar(size: number) {
												return h.span.attrs({'data-source': source.kind, style: `block-size: ${size}px`})
											}
											if (largest <= 8) return Array.makeBy(source.count, () => bar(Number.min(10, 40 / largest)))
											return [bar((40 * source.count) / largest)]
										})
									),
								h.span.class('stash-scale').attr('aria-hidden', 'true').children(date.axis)
							)
					})
				),
			h.div
				.class('stash-legend')
				.attr('aria-hidden', 'true')
				.children(Array.map(legend, kind => h.span.attr('data-source', kind).children(kinds[kind])))
		)
}

export function queueView(
	h: Html.H<Message>,
	notes: Array.NonEmptyReadonlyArray<NoteItem>,
	now: DateTime.Utc,
	row: (note: NoteItem) => View.Content<Message>
) {
	const groups = Array.groupWith(notes, (left, right) => savedOf(left, now) === savedOf(right, now))
	return [
		savesPlot(h, now, groups),
		h.div.class('stash-days').children(
			Array.map(groups, entries => {
				const date = saved(Array.headNonEmpty(entries).createdAt, now)
				return h.div
					.key(date.label)
					.class('stash-day')
					.children(
						h.div.class('stash-date').children(date.value, h.small.children(date.unit)),
						h.div.class('stash-day-items').children(Array.map(entries, row))
					)
			})
		)
	]
}
