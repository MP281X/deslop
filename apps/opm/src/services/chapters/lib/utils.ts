import {Array, DateTime, Number, Option, Order, Predicate, Record, String, pipe} from 'effect'

import type {ChapterItem, ChapterList, CubariSeries, Post} from '#services/chapters/schema.ts'

// "Chapter 242 [English]", "[Revised] Chapter 211 [English]"; a post of several chapters names each in its own post too.
const TITLE = /^(?:\[(?<tag>[^\]]*)\]\s*)?Chapter\s+(?<number>\d+(?:\.\d+)?)\s*\[English\]/iu

const CUBARI = /https:\/\/cubari\.moe\/read\/(?<source>imgchest|imgur|gist)\/(?<slug>[\w-]+)(?:\/(?<chapter>[\d.]+))?/u

// The proxy cubari's community index once used; the link it wraps still loads.
const WRAPPED = /^https:\/\/services\.f-ck\.me\/v1\/image\/(?<encoded>[\w+/=-]+)$/u

export const byNumber = Order.mapInput(Order.Number, (chapter: Pick<ChapterItem, 'number'>) => chapter.number)

// A Reddit post that links one English chapter, never the webcomic or a raw.
export function postFrom(entry: {content: string; published: string; title: string}) {
	return pipe(
		Option.fromNullishOr(TITLE.exec(String.trim(entry.title))?.groups),
		Option.filter(groups => !String.includes('webcomic')(String.toLowerCase(groups['tag'] ?? ''))),
		Option.flatMap(groups =>
			Option.all({
				link: Option.fromNullishOr(CUBARI.exec(entry.content)?.[0]),
				number: Number.parse(groups['number'] ?? ''),
				postedAt: Option.map(DateTime.make(entry.published), DateTime.toEpochMillis),
				revised: Option.some(String.includes('revised')(String.toLowerCase(groups['tag'] ?? '')))
			})
		)
	) satisfies Option.Option<Post>
}

// Where cubari answers with a link's pages, and which chapter of that answer the link means.
export function seriesOf(link: string) {
	return Option.map(Option.fromNullishOr(CUBARI.exec(link)?.groups), groups => ({
		api: `https://cubari.moe/read/api/${groups['source']}/series/${groups['slug']}/`,
		chapter: groups['chapter'] ?? '1'
	}))
}

// A page link cubari can still load: the dead proxy's links unwrap to the file they point at, and its error texts drop.
export function pageLink(page: CubariSeries['chapters'][string]['groups'][string][number]) {
	if (Predicate.isString(page)) return unwrapped(page)
	return unwrapped(page.src)
}

function unwrapped(link: string) {
	return Option.match(Option.fromNullishOr(WRAPPED.exec(link)?.groups?.['encoded']), {
		onNone: () => Option.some(link),
		onSome: encoded =>
			pipe(
				Option.liftThrowable(atob)(String.replaceAll('_', '/')(String.replaceAll('-', '+')(encoded))),
				Option.filter(String.startsWith('https://'))
			)
	})
}

// The first group's pages of one chapter of a cubari answer, when every page still loads.
export function pagesOf(series: CubariSeries, chapter: string) {
	return pipe(
		Option.fromNullishOr(series.chapters[chapter]),
		Option.flatMap(found => Array.head(Record.values(found.groups))),
		Option.flatMap(pages =>
			Option.liftPredicate(
				Array.getSomes(Array.map(pages, pageLink)),
				links => Array.isReadonlyArrayNonEmpty(links) && links.length === pages.length
			)
		)
	)
}

function isDone(chapter: ChapterItem) {
	return chapter.reading?.done === true
}

// The chapter the app opens on: the one read last while unfinished, else the next unread after it; none before any reading or once caught up.
export function resumeOf(chapters: ChapterList) {
	return pipe(
		Array.filter(chapters, chapter => chapter.reading !== undefined),
		Array.sort(Order.flip(Order.mapInput(Order.Number, (chapter: ChapterItem) => chapter.reading?.at ?? 0))),
		Array.head,
		Option.flatMap(last =>
			pipe(
				Array.sort(chapters, byNumber),
				Array.findFirst(chapter => chapter.number >= last.number && !isDone(chapter))
			)
		),
		Option.map(chapter => ({number: chapter.number, page: chapter.reading?.page ?? 0}))
	)
}

// The chapter's own name from a title such as "Chapter 225: New Blood 3"; a title that only repeats the number has none.
export function nameOf(title: string) {
	return String.trim(String.replace(/^.*?(?:Chapter|OPM)\s+[\d.]+\s*:?\s*/iu, '')(title))
}
