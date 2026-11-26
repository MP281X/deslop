import {Array, Boolean, Function, HashMap, HashSet, Number, Option, pipe} from 'effect'

import {keyOf} from '#services/chapters/lib/utils.ts'
import type {ChapterKey, ChapterList, ChapterNumber, Position, ReadingPosition} from '#services/chapters/schema.ts'

// One page turn in a reader opened on a chapter: the chapters from it on, in order, and the strip's page index.
export type PageTurn = {following: ChapterList; index: number; opened: ChapterNumber}

// What one opened reader has passed: the chapters its strip shows, the chapter in view and those it finished. The strip is kept from the first page turn on and only grows at its end, so a revised page or a filled gap cannot move the reader, and every page index the strip reported still names the same page.
export type ReaderState = {
	finished: HashSet.HashSet<ChapterNumber>
	inView: Option.Option<ChapterNumber>
	strip: ChapterList
}

// The chapters a reader shows: the opened one and the next until its first page turn keeps them.
export function stripOf(state: ReaderState, following: ChapterList) {
	return Array.match(state.strip, {onEmpty: () => Array.take(following, 2), onNonEmpty: shown => shown})
}

// The reading positions one page turn saves, in order, and the reader's next state; none for a page past the strip. Passing into the next chapter finishes every page of the one before it, and reaching the last chapter of the strip adds the next one.
export function turnPage(state: ReaderState, turn: PageTurn) {
	const shown = stripOf(state, turn.following)
	return pipe(
		Array.zip(
			shown,
			Array.scan(shown, 0, (total, chapter) => total + chapter.pages.length)
		),
		Array.findFirst(pair => turn.index < pair[1] + pair[0].pages.length),
		Option.map(pair => {
			const chapter = pair[0]
			const page = turn.index - pair[1]
			const previous = Option.getOrElse(state.inView, () => turn.opened)
			const before = Array.findFirst(shown, item => item.number === previous && item.number < chapter.number)
			const passed = Option.match(before, {
				onNone: () => state.finished,
				onSome: item => HashSet.add(state.finished, item.number)
			})
			// A finished chapter stays finished while it is read again; only "Unread" in the list starts it over.
			const finished = Boolean.match(
				page === chapter.pages.length - 1 || Option.exists(chapter.reading, reading => reading.done),
				{onFalse: () => passed, onTrue: () => HashSet.add(passed, chapter.number)}
			)
			const saves: (typeof ReadingPosition.json.Type)[] = [
				...Option.toArray(
					Option.map(before, item => ({
						done: true,
						number: item.number,
						page: item.pages.length - 1,
						series: item.series
					}))
				),
				{done: HashSet.has(finished, chapter.number), number: chapter.number, page, series: chapter.series}
			]
			const next: ReaderState = {
				finished,
				inView: Option.some(chapter.number),
				strip: pipe(
					Array.last(shown),
					Option.exists(item => item.number === chapter.number),
					Boolean.match({
						onFalse: () => shown,
						onTrue: () => [
							...shown,
							...Option.toArray(Array.findFirst(turn.following, item => item.number > chapter.number))
						]
					})
				)
			}
			return {next, saves}
		})
	)
}

// Places the server has not taken yet, such as pages turned offline, stand in for its own until a later save of the same chapter lands.
export function withUnsaved(chapters: ChapterList, unsaved: HashMap.HashMap<ChapterKey, Position>) {
	if (HashMap.isEmpty(unsaved)) return chapters
	return Array.map(chapters, chapter =>
		pipe(
			unsaved,
			HashMap.get(keyOf(chapter)),
			Option.match({onNone: () => chapter, onSome: reading => ({...chapter, reading: Option.some(reading)})})
		)
	)
}

// A cover or a wide page stands alone. Every other turn pairs the right page with the following left page.
export function turnsOf(chapters: ChapterList, spread: boolean, wide: HashSet.HashSet<string>) {
	const [, groups] = Array.mapAccum(chapters, 0, (offset, chapter) => {
		const [, turns] = Array.mapAccum(chapter.pages, false, (paired, right, page) => {
			const index = offset + page
			if (paired) return [false, Array.empty<number>()]
			const left = chapter.pages[page + 1]
			if (spread && page > 0 && left !== undefined && !HashSet.has(wide, right) && !HashSet.has(wide, left)) {
				return [true, [index, index + 1]]
			}
			return [false, [index]]
		})
		return [offset + chapter.pages.length, Array.filter(turns, Array.isArrayNonEmpty)]
	})
	return Array.flatten(groups)
}

export function savedPage(chapter?: ChapterList[number]) {
	if (chapter === undefined) return 0
	return Number.min(
		pipe(
			chapter.reading,
			Option.filter(position => !position.done),
			Option.match({onNone: Function.constant(0), onSome: position => position.page})
		),
		Number.max(0, chapter.pages.length - 1)
	)
}
