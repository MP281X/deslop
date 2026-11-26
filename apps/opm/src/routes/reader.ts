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

import {Button} from '@deslop/ui/control'
import {SidebarControl} from '@deslop/ui/glass'

import {savedPage, stripOf, turnsOf} from '#lib/reader.ts'
import {Message} from '#routes/model.ts'
import type {Model} from '#routes/model.ts'
import {byNumber} from '#services/chapters/lib/utils.ts'
import type {ChapterIdentity, ChapterList} from '#services/chapters/schema.ts'

type H = Html.H<Message>

export function chapterView(model: Model, target: ChapterIdentity, chapters: ChapterList) {
	if (model.reader === undefined) return undefined
	const following = pipe(
		chapters,
		Array.filter(chapter => chapter.series === target.series && chapter.number >= target.number),
		Array.sort(byNumber)
	)
	if (Array.isReadonlyArrayEmpty(model.reader.strip) && following[0]?.number !== target.number) return undefined
	const shown = stripOf(model.reader, following)
	const pages = Array.flatMap(shown, chapter => chapter.pages)
	const turns = turnsOf(shown, model.spread, model.wide)
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

export function Sidebar(h: H, open: boolean, message: Message) {
	return SidebarControl(h, open, message, 'opm-side')
}

function sideOf(model: Model, src: string, active: readonly number[], index: number) {
	if (!model.spread || HashSet.has(model.wide, src)) return 'single'
	if (index === active[1]) return 'left'
	return 'right'
}

function pageImage(h: H, failed: boolean, src: string, index: number) {
	if (failed) {
		return Button(h, {})
			.class('opm-retry-page')
			.attr('aria-label', 'Reload page')
			.on('click', () => Message.RetryPage({src}))
			.children('↻')
	}
	return h.img
		.attrs({alt: `Page ${index + 1}`, draggable: 'false', referrerpolicy: 'no-referrer', src})
		.onMount(Shape({src}))
}

export function Reading(
	h: H,
	model: Model,
	target: ChapterIdentity,
	reading: ReturnType<typeof chapterView>,
	waiting: boolean
) {
	const turn = reading?.turn ?? -1
	const active = reading?.turns[turn] ?? []
	const visible = HashSet.fromIterable(active)
	const last = (reading?.turns.length ?? 0) - 1
	const start = Number.max(0, turn - 1)
	const stripes = pipe(reading?.turns ?? [], Array.drop(start), Array.take(turn + 3 - start), Array.flatten)
	const chapter = Option.getOrElse(model.reader?.inView ?? Option.none(), () => target.number)
	return h.section
		.class('opm-reader')
		.key(`${target.series}:${target.number}`)
		.attr('aria-label', `Chapter ${chapter}`)
		.onMount(Motion({}))
		.children(
			h.div.class('opm-reader-top').children(Sidebar(h, false, Message.Close())),
			turn < 0 &&
				h.p
					.class('opm-notice')
					.attr('role', 'status')
					.children(
						Boolean.match(waiting, {
							onFalse: Function.constant('Chapter unavailable'),
							onTrue: Function.constant('Loading chapter…')
						})
					),
			h.div.class('opm-paper').children(
				Array.map(stripes, index => {
					const src = reading?.pages[index]
					if (src === undefined) return undefined
					return h.div
						.key(`${index}`)
						.class('opm-leaf')
						.attr('data-side', sideOf(model, src, active, index))
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
			),
			turn > 0 &&
				Button(h, {})
					.class('opm-turn opm-prev')
					.on('click', () => Message.Move({step: -1}))
					.children('Previous page'),
			turn >= 0 &&
				turn < last &&
				Button(h, {})
					.class('opm-turn opm-next')
					.on('click', () => Message.Move({step: 1}))
					.children('Next page')
		)
}
