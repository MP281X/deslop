import {
	Array,
	Boolean,
	DateTime,
	HashMap,
	HashSet,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Result,
	Schema,
	String,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'

import type {ChapterItem, CubariSeries, DeadLink, Post, Series} from '#services/chapters/schema.ts'
import {Chapter, ChapterNotification} from '#services/chapters/schema.ts'

// "Chapter 242 [English]", "[Revised] Chapter 211 [English]" and r/OPMFolk's "Chapter 242/287 [Translations]"; a post of several chapters names each in its own post too.
const TITLE =
	/^(?<tags>(?:\[[^\]]*\]\s*)*)Chapter\s+(?<number>\d+(?:\.\d+)?)(?:\/\d+)?\s*\[(?:English|Translations)\]/iu

const CUBARI = /https:\/\/cubari\.moe\/read\/(?<source>imgchest|imgur|gist)\/(?<slug>[\w-]+)(?:\/(?<chapter>[\d.]+))?/u

// The proxy cubari's community index once used; the link it wraps still loads.
const WRAPPED = /^https:\/\/services\.f-ck\.me\/v1\/image\/(?<encoded>[\w+/=-]+)$/u

export const SERIES_NAMES = {manga: 'Manga', webcomic: 'Webcomic'}

const CUBARI_LINKS = new RegExp(CUBARI.source, 'gu')

export const byNumber = Order.mapInput(Order.Number, (chapter: Pick<ChapterItem, 'number'>) => chapter.number)

export const INDEXES = {manga: 'OPM', webcomic: 'JYHJU'}

export function keyOf(chapter: Pick<ChapterItem, 'number' | 'series'>) {
	return `${chapter.series}:${chapter.number}`
}

export function revisionCandidates(posts: Post[], current: readonly Chapter[], deadLinks: readonly DeadLink[]) {
	const known = HashMap.fromIterable(Array.map(current, chapter => [keyOf(chapter), chapter] as const))
	const dead = HashSet.fromIterable(Array.map(deadLinks, item => `${item.key}\u0000${item.link}`))
	return pipe(
		posts,
		Array.sort(Order.mapInput(Order.Number, (post: Post) => post.postedAt)),
		Array.filterMap(post =>
			pipe(
				post.links,
				Array.filter(
					link =>
						!HashSet.has(dead, `${keyOf(post)}\u0000${link}`) &&
						pipe(
							HashMap.get(known, keyOf(post)),
							Option.match({
								onNone: () => true,
								onSome: item =>
									post.revised &&
									post.postedAt > Option.getOrElse(item.revisedAt, () => item.postedAt) &&
									link !== item.source
							})
						)
				),
				Array.match({onEmpty: () => Result.failVoid, onNonEmpty: links => Result.succeed({links, post})})
			)
		)
	)
}

function numbersOf(chapters: readonly Chapter[], kind: Series) {
	return Array.filterMap(chapters, chapter =>
		Boolean.match(chapter.series === kind, {
			onFalse: () => Result.failVoid,
			onTrue: () => Result.succeed(chapter.number)
		})
	)
}

// The whole numbers between a series' lowest and highest known chapter that no chapter fills, such as 231 and 232 before a source exists.
export function missingNumbers(chapters: readonly Chapter[], kind: Series) {
	const numbers = numbersOf(chapters, kind)
	if (!Array.isReadonlyArrayNonEmpty(numbers)) return Array.empty<number>()
	const known = HashSet.fromIterable(numbers)
	return Array.filter(
		Array.range(Math.ceil(Array.min(numbers, Order.Number)), Math.floor(Array.max(numbers, Order.Number))),
		number => !HashSet.has(known, number)
	)
}

// Every index chapter on a series' first read; later reads fill only the gaps between its lowest and highest known chapter.
export function indexChapters(current: readonly Chapter[], chapters: readonly Chapter[], kind: Series) {
	const known = HashSet.fromIterable(Array.map(current, keyOf))
	const numbers = numbersOf(current, kind)
	if (!Array.isReadonlyArrayNonEmpty(numbers)) {
		return Array.filter(chapters, chapter => !HashSet.has(known, keyOf(chapter)))
	}
	const low = Array.min(numbers, Order.Number)
	const high = Array.max(numbers, Order.Number)
	return Array.filter(
		chapters,
		chapter => !HashSet.has(known, keyOf(chapter)) && chapter.number > low && chapter.number < high
	)
}

export function notificationOf(data: unknown) {
	return Option.map(Schema.decodeUnknownOption(ChapterNotification)(data), target => ({
		number: target.path[2],
		series: target.path[0]
	}))
}

function seriesFromTags(tags: string) {
	if (String.includes('webcomic')(String.toLowerCase(tags))) return 'webcomic' as const
	return 'manga' as const
}

// A Reddit post that links one English chapter; raws and discussion posts are not releases.
export function postFrom(entry: {content: string; published: string; title: string}) {
	return Option.flatMap(Option.fromNullishOr(TITLE.exec(String.trim(entry.title))?.groups), groups =>
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
	) satisfies Option.Option<Post>
}

export function seriesOf(link: string) {
	return Option.map(Option.fromNullishOr(CUBARI.exec(link)?.groups), groups => ({
		api: `https://cubari.moe/read/api/${groups['source']}/series/${groups['slug']}/`,
		chapter: groups['chapter'] ?? '1'
	}))
}

function unwrapped(link: string) {
	return Option.match(Option.fromNullishOr(WRAPPED.exec(link)?.groups?.['encoded']), {
		onNone: () => Option.some(link),
		onSome: encoded => Option.filter(Result.getSuccess(Base64Url.decodeString(encoded)), String.startsWith('https://'))
	})
}

// A page link cubari can still load: the dead proxy's links unwrap to the file they point at, and its error texts drop.
function pageLink(page: CubariSeries['chapters'][string]['groups'][string][number]) {
	if (Predicate.isString(page)) return unwrapped(page)
	return unwrapped(page.src)
}

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

// The chapter's own name from "Chapter 225: New Blood 3"; a title of only the number or a scanlation note has none.
export function nameOf(title: string) {
	const name = String.trim(String.replace(/^.*?(?:Chapter|OPM(?:\s+WC)?)\s+[\d.]+\s*[:–—-]?\s*/iu, '')(title))
	return Option.match(String.match(/^(?:translated|english(?:\s+translations?)?|translations?|raw)$/iu)(name), {
		onNone: () => name,
		onSome: () => ''
	})
}

export function chaptersFromIndex(index: CubariSeries, kind: Series) {
	return Array.filterMap(Record.toEntries(index.chapters), entry =>
		pipe(
			Option.all({
				number: Number.parse(entry[0]),
				pages: pagesOf(index, entry[0]),
				postedAt: Option.some(
					Boolean.match(kind === 'webcomic', {
						onFalse: () => Option.getOrElse(Array.head(Record.values(entry[1].release_date ?? {})), () => 0) * 1000,
						onTrue: () => 0
					})
				)
			}),
			Option.map(found =>
				Chapter.make({
					...found,
					notified: true,
					reading: Option.none(),
					revisedAt: Option.none(),
					series: kind,
					source: `https://cubari.moe/read/gist/${INDEXES[kind]}/${entry[0]}/1/`,
					title: nameOf(entry[1].title ?? '')
				})
			),
			Result.fromOption(() => undefined)
		)
	)
}
