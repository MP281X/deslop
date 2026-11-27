import {Mount} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {
	Array,
	Boolean,
	Effect,
	Function,
	HashSet,
	MutableRef,
	Number,
	Option,
	Queue,
	Schema,
	Stream,
	pipe
} from 'effect'

import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Placeholder} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'
import {SymbolIcon} from '@deslop/ui/symbol'

import type {ChapterIdentity, ChapterList} from '#contracts'
import {byChapterNumber} from '#contracts'

import {Message} from '#web/chapters/model.ts'
import type {Model} from '#web/chapters/model.ts'
import {savedPage, stripOf, turnsOf} from '#web/chapters/reading.ts'

type H = Html.H<Message>

export function chapterView(model: Model, target: ChapterIdentity, chapters: ChapterList) {
	if (model.reader === undefined) return undefined
	const following = pipe(
		chapters,
		Array.filter(chapter => chapter.series === target.series && chapter.number >= target.number),
		Array.sort(byChapterNumber)
	)
	if (Array.isReadonlyArrayEmpty(model.reader.strip) && following[0]?.number !== target.number) return undefined
	const shown = stripOf(model.reader, following)
	const pages = Array.flatMap(shown, chapter => chapter.pages)
	const turns = turnsOf(shown, model.spread && (model.narrow || model.listHidden), model.wide)
	const page = model.reader.page ?? savedPage(shown[0])
	const turn = pipe(
		turns,
		Array.findFirstIndex(pair => Array.contains(pair, page)),
		Option.getOrElse(Function.constant(-1))
	)
	return {following, pages, shown, turn, turns}
}

const Motion = Mount.makeStream('Opm/Motion', {args: {}}, (node: HTMLElement) =>
	Stream.callback<Message>(queue =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const pressed = MutableRef.make(Option.none<{id: number; x: number; y: number}>())
				function down(event: PointerEvent) {
					if (event.button !== 0 || !event.isPrimary) return
					if (event.target instanceof Element && event.target.closest('button') !== null) return
					MutableRef.set(pressed, Option.some({id: event.pointerId, x: event.clientX, y: event.clientY}))
					node.setPointerCapture(event.pointerId)
				}
				function up(event: PointerEvent) {
					const start = Option.getOrUndefined(MutableRef.get(pressed))
					if (start?.id !== event.pointerId) return
					const dx = event.clientX - start.x
					const dy = event.clientY - start.y
					MutableRef.set(pressed, Option.none())
					if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) {
						Queue.offerUnsafe(
							queue,
							Message.Move({
								step: Boolean.match(dx > 0, {onFalse: Function.constant(-1), onTrue: Function.constant(1)})
							})
						)
					} else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
						Queue.offerUnsafe(queue, Message.ToggleBars())
					}
				}
				function cancel() {
					MutableRef.set(pressed, Option.none())
				}
				node.addEventListener('pointerdown', down)
				node.addEventListener('pointerup', up)
				node.addEventListener('pointercancel', cancel)
				return () => {
					node.removeEventListener('pointerdown', down)
					node.removeEventListener('pointerup', up)
					node.removeEventListener('pointercancel', cancel)
				}
			}),
			remove => Effect.sync(remove)
		)
	)
)

const Shape = Mount.makeStream('Opm/PageShape', {args: {src: Schema.String}}, (node: HTMLImageElement, page) =>
	Stream.callback<Message>(queue =>
		Effect.acquireRelease(
			Effect.sync(() => {
				function loaded() {
					Queue.offerUnsafe(
						queue,
						Message.Image({
							failed: node.naturalWidth === 0,
							src: page.src,
							wide: node.naturalWidth > node.naturalHeight
						})
					)
				}
				node.addEventListener('load', loaded)
				node.addEventListener('error', loaded)
				if (node.complete) loaded()
				return () => {
					node.removeEventListener('load', loaded)
					node.removeEventListener('error', loaded)
				}
			}),
			remove => Effect.sync(remove)
		)
	)
)

function sideOf(active: readonly number[], index: number) {
	if (active.length < 2) return 'single'
	if (index === active[1]) return 'left'
	return 'right'
}

function pageImage(h: H, failed: boolean, src: string, index: number) {
	if (failed) {
		return Glass(h, 'opm-retry-page').children(
			Button(h)
				.attr('aria-label', 'Reload page')
				.on('click', Message.RetryPage({src}))
				.children(SymbolIcon(h, 'arrow.clockwise'))
		)
	}
	return h.img
		.attrs({alt: `Page ${index + 1}`, draggable: 'false', referrerpolicy: 'no-referrer', src})
		.onMount(Shape({src}))
}

export function Reading(
	h: Html.H<Message>,
	model: Model,
	target: ChapterIdentity,
	reading: ReturnType<typeof chapterView>,
	waiting: boolean
) {
	const turn = reading?.turn ?? -1
	const active = reading?.turns[turn] ?? []
	const visible = HashSet.fromIterable(active)
	const start = Number.max(0, turn - 1)
	const stripes = pipe(reading?.turns ?? [], Array.drop(start), Array.take(turn + 3 - start), Array.flatten)
	const chapter = Option.getOrElse(model.reader?.inView ?? Option.none(), () => target.number)
	return h.section
		.class('opm-reader')
		.key(`${target.series}:${target.number}`)
		.attr('aria-label', `Chapter ${chapter}`)
		.onMount(Motion({}))
		.children(
			turn < 0 &&
				(waiting
					? Loading(h, 'Loading chapter', Placeholder(h, 'opm-page-placeholder'))
					: Notice(h, 'Chapter unavailable')),
			h.div.class('opm-paper').children(
				Array.map(stripes, index => {
					const src = reading?.pages[index]
					if (src === undefined) return undefined
					return h.div
						.key(`${index}`)
						.class('opm-leaf')
						.attr('data-side', sideOf(active, index))
						.attr(
							'hidden',
							pipe(
								visible,
								HashSet.has(index),
								Boolean.match({onFalse: Function.constant(''), onTrue: Function.constUndefined})
							)
						)
						.children(pageImage(h, HashSet.has(model.failed, src), src, index))
				})
			)
		)
}

export function pageActions(reading: ReturnType<typeof chapterView>): readonly ShellAction<Message>[] {
	if (reading === undefined || reading.turn < 0) return []
	const next: ShellAction<Message> = {
		id: 'next-page',
		message: Message.Move({step: 1}),
		symbol: 'chevron.left',
		title: 'Next page'
	}
	const previous: ShellAction<Message> = {
		id: 'previous-page',
		message: Message.Move({step: -1}),
		symbol: 'chevron.right',
		title: 'Previous page'
	}
	return Array.filter(
		[reading.turn < reading.turns.length - 1 && next, reading.turn > 0 && previous],
		(action): action is ShellAction<Message> => action !== false
	)
}
