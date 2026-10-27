import {Array, DateTime, Number, Option, Order, Predicate, Record, Schema, String, pipe} from 'effect'

import type {ChapterItem, ChapterList, CubariSeries, Post} from '#services/chapters/schema.ts'
import {ChapterNotification} from '#services/chapters/schema.ts'

// "Chapter 242 [English]", "[Revised] Chapter 211 [English]" and r/OPMFolk's "Chapter 242/287 [Translations]"; a post of several chapters names each in its own post too.
const TITLE =
	/^(?<tags>(?:\[[^\]]*\]\s*)*)Chapter\s+(?<number>\d+(?:\.\d+)?)(?:\/\d+)?\s*\[(?:English|Translations)\]/iu

const CUBARI = /https:\/\/cubari\.moe\/read\/(?<source>imgchest|imgur|gist)\/(?<slug>[\w-]+)(?:\/(?<chapter>[\d.]+))?/u

// The proxy cubari's community index once used; the link it wraps still loads.
const WRAPPED = /^https:\/\/services\.f-ck\.me\/v1\/image\/(?<encoded>[\w+/=-]+)$/u

export const SERIES_NAMES = {manga: 'Manga', webcomic: 'Webcomic'}

// A release post lists every translation, best first.
const CUBARI_LINKS = new RegExp(CUBARI.source, 'gu')

export const byNumber = Order.mapInput(Order.Number, (chapter: Pick<ChapterItem, 'number'>) => chapter.number)

export function keyOf(chapter: Pick<ChapterItem, 'number' | 'series'>) {
	return `${chapter.series}:${chapter.number}`
}

export function notificationOf(data: unknown) {
	return Option.map(Schema.decodeUnknownOption(ChapterNotification)(data), target => ({
		number: target.path[2],
		series: target.path[0]
	}))
}

// A Reddit post that links one English chapter; raws and discussion posts are not releases.
export function postFrom(entry: {content: string; published: string; title: string}) {
	return pipe(
		Option.fromNullishOr(TITLE.exec(String.trim(entry.title))?.groups),
		Option.flatMap(groups =>
			Option.all({
				links: Option.liftPredicate(
					Array.dedupe(Array.map(Array.fromIterable(String.matchAll(CUBARI_LINKS)(entry.content)), match => match[0])),
					Array.isArrayNonEmpty<string>
				),
				number: Number.parse(groups['number'] ?? ''),
				postedAt: Option.map(DateTime.make(entry.published), DateTime.toEpochMillis),
				revised: Option.some(String.includes('revised')(String.toLowerCase(groups['tags'] ?? ''))),
				series: Option.some(seriesFromTags(groups['tags'] ?? ''))
			})
		)
	) satisfies Option.Option<Post>
}

function seriesFromTags(tags: string) {
	if (String.includes('webcomic')(String.toLowerCase(tags))) return 'webcomic' as const
	return 'manga' as const
}

// Where cubari answers with a link's pages, and which chapter of that answer the link means.
export function seriesOf(link: string) {
	return Option.map(Option.fromNullishOr(CUBARI.exec(link)?.groups), groups => ({
		api: `https://cubari.moe/read/api/${groups['source']}/series/${groups['slug']}/`,
		chapter: groups['chapter'] ?? '1'
	}))
}

// A page link cubari can still load: the dead proxy's links unwrap to the file they point at, and its error texts drop.
function pageLink(page: CubariSeries['chapters'][string]['groups'][string][number]) {
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

// Reopen what was read last, including a finished chapter; choosing the next one belongs to the reader.
export function resumeOf(chapters: ChapterList) {
	return pipe(
		Array.filter(chapters, chapter => (chapter.reading?.at ?? 0) > 0),
		Array.sort(Order.flip(Order.mapInput(Order.Number, (chapter: ChapterItem) => chapter.reading?.at ?? 0))),
		Array.head,
		Option.map(chapter => ({number: chapter.number, page: chapter.reading?.page ?? 0}))
	)
}

// The chapter's own name from "Chapter 225: New Blood 3"; a title of only the number or a scanlation note has none.
export function nameOf(title: string) {
	const name = String.trim(String.replace(/^.*?(?:Chapter|OPM(?:\s+WC)?)\s+[\d.]+\s*[:–—-]?\s*/iu, '')(title))
	return Option.match(String.match(/^(?:translated|english(?:\s+translations?)?|translations?|raw)$/iu)(name), {
		onNone: () => name,
		onSome: () => ''
	})
}
