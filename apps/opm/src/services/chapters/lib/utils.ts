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

import type {Chapter, ChapterItem, ChapterList, CubariSeries, Post, Series} from '#services/chapters/schema.ts'
import {ChapterNotification} from '#services/chapters/schema.ts'

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

export function indexUrl(series: Series) {
	return `https://cubari.moe/read/gist/${INDEXES[series]}/`
}

export function keyOf(chapter: Pick<ChapterItem, 'number' | 'series'>) {
	return `${chapter.series}:${chapter.number}`
}

export function mergeMissingChapters(current: Chapter[], chapters: Chapter[]) {
	const numbers = HashSet.fromIterable(Array.map(current, keyOf))
	return Array.sort(
		[...current, ...Array.filter(chapters, chapter => !HashSet.has(numbers, keyOf(chapter)))],
		Order.flip(byNumber)
	)
}

export function revisionCandidates(posts: Post[], current: Chapter[]) {
	const known = HashMap.fromIterable(Array.map(current, chapter => [keyOf(chapter), chapter] as const))
	return Array.filterMap(
		Array.sort(
			posts,
			Order.mapInput(Order.Number, (post: Post) => post.postedAt)
		),
		post =>
			Array.match(
				Array.filter(post.links, link =>
					Option.match(HashMap.get(known, keyOf(post)), {
						onNone: () => true,
						onSome: item => post.revised && post.postedAt > (item.revisedAt ?? item.postedAt) && link !== item.source
					})
				),
				{onEmpty: () => Result.failVoid, onNonEmpty: links => Result.succeed({links, post})}
			)
	)
}

export function reconcileChapters(current: Chapter[], found: Chapter[], now: number) {
	const loaded = HashMap.fromIterable(Array.map(found, chapter => [keyOf(chapter), chapter] as const))
	const revised = Array.map(current, item =>
		Option.match(HashMap.get(loaded, keyOf(item)), {
			onNone: () => item,
			onSome: chapter => ({...item, pages: chapter.pages, revisedAt: chapter.postedAt, source: chapter.source})
		})
	)
	const present = HashSet.fromIterable(Array.map(current, keyOf))
	const added = Array.map(
		Array.filter(Array.fromIterable(HashMap.values(loaded)), chapter => !HashSet.has(present, keyOf(chapter))),
		chapter => ({...chapter, notified: now - chapter.postedAt > 86_400_000})
	)
	return Array.sort([...revised, ...added], Order.flip(byNumber))
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

export function seriesOf(link: string) {
	return Option.map(Option.fromNullishOr(CUBARI.exec(link)?.groups), groups => ({
		api: `https://cubari.moe/read/api/${groups['source']}/series/${groups['slug']}/`,
		chapter: groups['chapter'] ?? '1'
	}))
}

function unwrapped(link: string) {
	return Option.match(Option.fromNullishOr(WRAPPED.exec(link)?.groups?.['encoded']), {
		onNone: () => Option.some(link),
		onSome: encoded =>
			pipe(Result.getSuccess(Base64Url.decodeString(encoded)), Option.filter(String.startsWith('https://')))
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

export function resumeOf(chapters: ChapterList) {
	return pipe(
		Array.filter(chapters, chapter => (chapter.reading?.at ?? 0) > 0),
		Array.match({
			onEmpty: () => Option.none<ChapterItem>(),
			onNonEmpty: items =>
				Option.some(
					Array.max(
						items,
						Order.mapInput(Order.Number, (chapter: ChapterItem) => chapter.reading?.at ?? 0)
					)
				)
		}),
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
			Option.map(found => ({
				...found,
				notified: true,
				series: kind,
				source: `${indexUrl(kind)}${entry[0]}/1/`,
				title: nameOf(entry[1].title ?? '')
			})),
			Result.fromOption(() => undefined)
		)
	)
}
