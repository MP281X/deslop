import {Array, Boolean, DateTime, Function, HashMap, HashSet, Number, Option, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {dayOf} from '@deslop/runtime/shared/format'

import {OpmRoute, libraryOf, targetOf} from '#reads'

import {
	ChapterIdentity,
	ChapterKey,
	ChapterNumber,
	Position,
	ReadingChapter,
	SERIES_NAMES,
	Series,
	byChapterNumber,
	keyOf
} from './contract.ts'
import {savedPage, stripOf, turnsOf, withUnsaved} from './shared.ts'

const CatalogueRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ReadingChapter)})
const Press = {pointerId: Schema.Int, x: Schema.Finite, y: Schema.Finite}

export type Direction = typeof Direction.Type
const Direction = Schema.Literals([-1, 1])

type ReadingState = typeof ReadingState.Type
const ReadingState = Schema.Struct({
	bars: Schema.Boolean,
	expired: Schema.Boolean,
	finished: Schema.HashSet(ChapterNumber),
	inView: Schema.Option(ChapterNumber),
	page: Schema.UndefinedOr(Schema.Natural),
	press: Schema.UndefinedOr(Schema.Struct(Press)),
	strip: Schema.Array(ReadingChapter)
})

// What the chapters and the reader keep of the screen, and the messages that change it.
export const chaptersFields = {
	catalogue: CatalogueRead,
	covers: Schema.HashSet(Schema.String),
	failed: Schema.HashSet(Schema.String),
	reader: Schema.UndefinedOr(ReadingState),
	shapes: Schema.HashMap(Schema.String, Schema.Finite),
	unsaved: Schema.HashMap(ChapterKey, Position)
}

export const chaptersMessages = {
	Catalogue: {catalogue: CatalogueRead},
	CoverSettled: {src: Schema.String},
	Expired: {chapter: ChapterIdentity},
	Gesture: {dx: Schema.Finite, dy: Schema.Finite},
	Image: {aspect: Schema.Finite, src: Schema.String},
	PointerCancel: {pointerId: Press.pointerId},
	PointerDown: Press,
	PointerUp: Press,
	RetryPage: {src: Schema.String},
	Unsaved: {unsaved: chaptersFields.unsaved}
}

export type ChaptersModel = typeof ChaptersModel.Type
const ChaptersModel = Schema.Struct({
	...chaptersFields,
	height: Schema.Finite,
	listHidden: Schema.Boolean,
	route: OpmRoute,
	width: Schema.Finite
})

export function wideOf(size: {height: number; width: number}) {
	return size.width >= 640 && (size.width >= 800 || size.height >= 600)
}

export function bookOf(size: {height: number; width: number}) {
	return size.width >= 700 && size.height > 0 && size.width > size.height
}

function chaptersOf(model: ChaptersModel) {
	return Option.match(AsyncResult.value(model.catalogue), {
		onNone: () => Array.empty<ReadingChapter>(),
		onSome: all => withUnsaved(all, model.unsaved)
	})
}

export function chapterOf(model: ChaptersModel, id: string) {
	return Array.findFirst(chaptersOf(model), chapter => keyOf(chapter) === id)
}

export function chapterView(model: ChaptersModel, target: ChapterIdentity) {
	if (model.reader === undefined) return undefined
	const following = pipe(
		chaptersOf(model),
		Array.filter(chapter => chapter.series === target.series && chapter.number >= target.number),
		Array.sort(byChapterNumber)
	)
	if (Array.isReadonlyArrayEmpty(model.reader.strip) && following[0]?.number !== target.number) return undefined
	const shown = stripOf(model.reader, following)
	const pages = Array.flatMap(shown, chapter => chapter.pages)
	const widePages = HashMap.reduce(model.shapes, HashSet.empty<string>(), (wide, aspect, src) => {
		if (aspect > 1) return HashSet.add(wide, src)
		return wide
	})
	const turns = turnsOf(shown, bookOf(model) && model.listHidden, widePages)
	const page = model.reader.page ?? savedPage(shown[0])
	const turn = pipe(
		turns,
		Array.findFirstIndex(pair => Array.contains(pair, page)),
		Option.getOrElse(Function.constant(-1))
	)
	return {following, pages, shown, turn, turns}
}

export function openedReader() {
	return {
		bars: false,
		expired: false,
		finished: HashSet.empty<ChapterNumber>(),
		inView: Option.none<ChapterNumber>(),
		page: undefined,
		press: undefined,
		strip: []
	}
}

// Freeze the chapter and its exact page before a fold changes the turn around it.
export function opened<Model extends ChaptersModel>(model: Model) {
	const target = targetOf(model.route)
	if (target === undefined || model.reader === undefined || model.reader.page !== undefined) return model
	const reading = chapterView(model, target)
	if (reading === undefined) return model
	return {...model, reader: {...model.reader, page: savedPage(reading.shown[0]), strip: reading.shown}}
}

function dateOf(postedAt: ReadingChapter['postedAt'], now: DateTime.Utc) {
	return Option.match(postedAt, {
		onNone: Function.constant(''),
		onSome: at => {
			if (DateTime.toDate(at).toDateString() === DateTime.toDate(now).toDateString()) return 'Today'
			return dayOf(at, now)
		}
	})
}

// What the screen draws of the chapters: both lists of the chosen series, the reader's pages and the turns around them.
export function chaptersScreen(model: ChaptersModel, now: DateTime.Utc, viewer: boolean) {
	const target = targetOf(model.route)
	const series = libraryOf(model.route).search.series ?? 'manga'
	const waiting = !viewer || Option.isNone(AsyncResult.value(model.catalogue))
	const reading = pipe(
		Option.fromUndefinedOr(target),
		Option.filter(() => viewer),
		Option.flatMap(chapter => Option.fromUndefinedOr(chapterView(model, chapter))),
		Option.getOrUndefined
	)
	const chapters = Array.filter(chaptersOf(model), chapter => chapter.series === series)
	const current = Option.getOrUndefined(model.reader?.inView ?? Option.none()) ?? target?.number
	const rows = Array.map(chapters, chapter => {
		const done = Option.exists(chapter.reading, position => position.done)
		const place = Option.filter(chapter.reading, position => !position.done && position.page > 0)
		return {
			active: wideOf(model) && !model.listHidden && chapter.number === current,
			chapter: {number: chapter.number, series: chapter.series},
			cover: chapter.pages[0],
			coverOpacity: Boolean.match(done, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)}),
			data: {
				id: keyOf(chapter),
				line: pipe([chapter.title, dateOf(chapter.postedAt, now)], Array.filter(String.isNonEmpty), Array.join(' · ')),
				title: `Chapter ${chapter.number}`,
				trailing: Option.match(place, {
					onNone: () => `${chapter.pages.length} p`,
					onSome: position => `${position.page + 1}/${chapter.pages.length}`
				})
			},
			muted: done
		}
	})
	// A pane starts one cover at a time, leaving the native image loader room for reader pages.
	function listOf(older: boolean, shown: typeof rows) {
		const next = Option.getOrUndefined(
			Array.findFirst(shown, row => row.cover !== undefined && !HashSet.has(model.covers, row.cover))
		)
		return {
			empty: Array.isReadonlyArrayEmpty(shown) && !older,
			label: Boolean.match(older, {
				onFalse: Function.constant('Chapters'),
				onTrue: Function.constant('Older chapters')
			}),
			rows: Array.map(shown, row => ({
				...row,
				loadCover: row === next || (row.cover !== undefined && HashSet.has(model.covers, row.cover))
			}))
		}
	}
	const turn = reading?.turn ?? -1
	const active = reading?.turns[turn] ?? []
	const visible = HashSet.fromIterable(active)
	const start = Number.max(0, turn - 1)
	const stripes = pipe(reading?.turns ?? [], Array.drop(start), Array.take(turn + 3 - start), Array.flatten)
	function sideOf(index: number) {
		if (active.length < 2) return 'single' as const
		if (index === active[1]) return 'left' as const
		return 'right' as const
	}
	const pages = Array.flatMap(stripes, index =>
		pipe(
			Option.fromUndefinedOr(reading?.pages[index]),
			Option.map(src => ({
				aspect: pipe(model.shapes, HashMap.get(src), Option.getOrElse(Function.constant(0.71))),
				failed: HashSet.has(model.failed, src),
				index,
				side: sideOf(index),
				src,
				visible: HashSet.has(visible, index)
			})),
			Option.toArray
		)
	)
	const book = bookOf(model)
	const halves = Boolean.match(book && target === undefined, {
		onFalse: () => rows.length,
		onTrue: () => Math.ceil(rows.length / 2)
	})
	function listWidth() {
		if (book) return model.width / 2
		if (model.width >= 1000) return 380
		return 270
	}
	return {
		bars: model.reader?.bars === true,
		book,
		covers: model.covers,
		height: model.height,
		latest: listOf(false, Array.take(rows, halves)),
		listHidden: model.listHidden,
		listWidth: listWidth(),
		next: turn >= 0 && turn < (reading?.turns.length ?? 0) - 1,
		older: listOf(true, Array.drop(rows, halves)),
		pages,
		previous: turn > 0,
		reader: pipe(
			Option.fromUndefinedOr(target),
			Option.map(chapter => ({
				id: keyOf(chapter),
				ready: turn >= 0,
				title: `Chapter ${current ?? chapter.number}`,
				waiting: turn < 0 && (waiting || model.reader?.expired === false)
			})),
			Option.getOrUndefined
		),
		series,
		seriesChoices: Array.map(Series.literals, choice => ({
			checked: choice === series,
			series: choice,
			title: SERIES_NAMES[choice]
		})),
		stale: AsyncResult.isFailure(model.catalogue),
		waiting,
		wide: wideOf(model),
		width: model.width
	}
}

export type ChapterRow = ReturnType<typeof chaptersScreen>['latest']['rows'][number]
