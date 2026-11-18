import {
	Array,
	Boolean,
	DateTime,
	Filter,
	Function,
	HashMap,
	HashSet,
	Option,
	Order,
	Predicate,
	Record,
	Result,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'

import type {ChapterIdentity, ChapterState, CubariSeries, DeadLink, Post, Series} from '#services/chapters/schema.ts'
import {
	Chapter,
	ChapterKey,
	ChapterNumber,
	ChapterNumberFromString,
	ChapterNotification
} from '#services/chapters/schema.ts'

// "Chapter 242 [English]", "[Revised] Chapter 211 [English]" and r/OPMFolk's "Chapter 242/287 [Translations]"; a post of several chapters names each in its own post too.
const TITLE =
	/^(?<tags>(?:\[[^\]]*\]\s*)*)Chapter\s+(?<number>\d+(?:\.\d+)?)(?:\/\d+)?\s*\[(?:English|Translations)\]/iu

const CUBARI = /https:\/\/cubari\.moe\/read\/(?<source>imgchest|imgur|gist)\/(?<slug>[\w-]+)(?:\/(?<chapter>[\d.]+))?/u

// The proxy cubari's community index once used; the link it wraps still loads.
const WRAPPED = /^https:\/\/services\.f-ck\.me\/v1\/image\/(?<encoded>[\w+/=-]+)$/u

// A scanlation group named for untranslated pages.
const RAW_GROUP = /\b(?:raws?|japanese|jp)\b/iu

export const SERIES_NAMES = {manga: 'Manga', webcomic: 'Webcomic'}

const CUBARI_LINKS = new RegExp(CUBARI.source, 'gu')

export const byNumber = Order.mapInput(Order.Number, (chapter: Pick<Chapter, 'number'>) => chapter.number)

export const INDEXES = {manga: 'OPM', webcomic: 'JYHJU'}

export function keyOf(chapter: ChapterIdentity) {
	return ChapterKey.make(`${chapter.series}:${chapter.number}`)
}

// Each chapter's candidate links, keyed and in the order to try them: a new chapter takes its first post, a known one the newest explicit revision that reads.
export function revisionCandidates(
	posts: readonly Post[],
	current: readonly ChapterState[],
	deadLinks: readonly DeadLink[]
) {
	const known = HashMap.fromIterable(Array.map(current, chapter => [keyOf(chapter), chapter] as const))
	const dead = HashSet.fromIterable(Array.map(deadLinks, item => `${item.key}\u0000${item.link}`))
	const byPosted = Order.mapInput(DateTime.Order, (candidate: {post: Post}) => candidate.post.postedAt)
	return pipe(
		posts,
		Array.filterMap(post =>
			pipe(
				post.links,
				Array.filter(
					link =>
						!HashSet.has(dead, `${keyOf(post)}\u0000${link}`) &&
						pipe(
							known,
							HashMap.get(keyOf(post)),
							Option.match({
								onNone: Function.constTrue,
								onSome: item =>
									post.revised &&
									pipe(
										item.revisedAt,
										Option.orElse(() => item.postedAt),
										Option.match({onNone: Function.constTrue, onSome: at => DateTime.isGreaterThan(post.postedAt, at)})
									) &&
									link !== item.source
							})
						)
				),
				Array.match({onEmpty: () => Result.failVoid, onNonEmpty: links => Result.succeed({links, post})})
			)
		),
		Array.groupBy(candidate => keyOf(candidate.post)),
		Record.toEntries,
		Array.map(
			group =>
				[
					ChapterKey.make(group[0]),
					Array.sort(
						group[1],
						pipe(
							known,
							HashMap.has(group[0]),
							Boolean.match({onFalse: () => byPosted, onTrue: () => Order.flip(byPosted)})
						)
					)
				] as const
		)
	)
}

function numbersOf(chapters: readonly ChapterIdentity[], kind: Series) {
	return Array.filterMap(chapters, chapter =>
		Boolean.match(chapter.series === kind, {
			onFalse: () => Result.failVoid,
			onTrue: () => Result.succeed(chapter.number)
		})
	)
}

// The runs of whole numbers no chapter fills between two neighbouring known chapters, such as 231 to 232 before a source exists; one run per gap, however far apart its ends.
export function missingRanges(chapters: readonly ChapterIdentity[], kind: Series) {
	const numbers = pipe(numbersOf(chapters, kind), Array.dedupe, Array.sort(Order.Number))
	return pipe(
		numbers,
		Array.zip(Array.drop(numbers, 1)),
		Array.filterMap(pair => {
			const from = Math.floor(pair[0]) + 1
			const to = Math.ceil(pair[1]) - 1
			if (from > to) return Result.failVoid
			return Result.succeed({from: ChapterNumber.make(from), to: ChapterNumber.make(to)})
		})
	)
}

// Keep unknown index chapters on the first read; later keep only unknown chapters above the known minimum, marking those at or below the known maximum as notified.
export function indexChapters(current: readonly ChapterIdentity[], chapters: readonly Chapter[], kind: Series) {
	const known = HashSet.fromIterable(Array.map(current, keyOf))
	const numbers = numbersOf(current, kind)
	if (!Array.isReadonlyArrayNonEmpty(numbers)) {
		return Array.filter(chapters, chapter => !HashSet.has(known, keyOf(chapter)))
	}
	const low = Array.min(numbers, Order.Number)
	const high = Array.max(numbers, Order.Number)
	return pipe(
		chapters,
		Array.filter(chapter => !HashSet.has(known, keyOf(chapter)) && chapter.number > low),
		Array.map(chapter =>
			Chapter.make({...Struct.pick(chapter, Struct.keys(Chapter.fields)), notified: chapter.number <= high})
		)
	)
}

// What one round writes, weighed against the catalogue it started from: Reddit's new chapters and explicit revisions, then the index chapters Reddit did not bring, so a release both bring keeps Reddit's pages. A known chapter takes only an explicit revision's pages, so a second translation never moves a reader's page.
export function roundChapters(
	current: readonly ChapterState[],
	fromReddit: readonly Chapter[],
	indexes: readonly {chapters: readonly Chapter[]; kind: Series}[]
) {
	const known = HashSet.fromIterable(Array.map(current, keyOf))
	const [fresh, revisions] = Array.partition(
		fromReddit,
		Filter.fromPredicate(chapter => !HashSet.has(known, keyOf(chapter)))
	)
	const found = HashSet.fromIterable(Array.map(fresh, keyOf))
	return {
		backfilled: Array.flatMap(indexes, index =>
			Array.filter(indexChapters(current, index.chapters, index.kind), chapter => !HashSet.has(found, keyOf(chapter)))
		),
		fresh,
		revisions
	}
}

export function notificationOf(payload: unknown) {
	return Option.map(Schema.decodeUnknownOption(ChapterNotification)(payload), target => ({
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
			number: Schema.decodeUnknownOption(ChapterNumberFromString)(groups['number']),
			postedAt: DateTime.make(entry.published),
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

// Only an https link reaches the iPhone, which loads every page it is given; the dead proxy's links unwrap to the file they point at.
function publicLink(link: string) {
	return pipe(
		Option.fromNullishOr(WRAPPED.exec(link)?.groups?.['encoded']),
		Option.match({
			onNone: () => Option.some(link),
			onSome: encoded => Result.getSuccess(Base64Url.decodeString(encoded))
		}),
		Option.filter(String.startsWith('https://'))
	)
}

function pageLink(page: CubariSeries['chapters'][string]['groups'][string][number]) {
	if (Predicate.isString(page)) return publicLink(page)
	return publicLink(page.src)
}

// A group's pages, if every one loads and they are no more than a chapter holds; the dead proxy's error texts drop.
function groupPages(pages: CubariSeries['chapters'][string]['groups'][string]) {
	return Option.liftPredicate(
		Array.getSomes(Array.map(pages, pageLink)),
		// Chapters run to a few dozen pages; the iPhone lays out every page of the list it is given.
		links => Array.isReadonlyArrayNonEmpty(links) && links.length === pages.length && links.length <= 500
	)
}

// The first group whose pages all load, raws last, so a chapter reads in English whenever a translation is there.
export function pagesOf(series: CubariSeries, chapter: string) {
	return Option.flatMap(Option.fromNullishOr(series.chapters[chapter]), found =>
		pipe(
			Record.toEntries(found.groups),
			Array.sort(Order.mapInput(Boolean.Order, (group: readonly [string, unknown]) => RAW_GROUP.test(group[0]))),
			Array.map(group => groupPages(group[1])),
			Array.getSomes,
			Array.head
		)
	)
}

// The chapter's own name from "Chapter 225: New Blood 3"; a title of only the number or a scanlation note has none.
export function nameOf(title: string) {
	const name = String.trim(String.replace(/^.*?(?:Chapter|OPM(?:\s+WC)?)\s+[\d.]+\s*[:–—-]?\s*/iu, '')(title))
	return Option.match(String.match(/^(?:translated|english(?:\s+translations?)?|translations?|raw)$/iu)(name), {
		onNone: () => name,
		onSome: Function.constant('')
	})
}

// One chapter per number: a key the index spells twice, such as 243.5 and 243.50, keeps its first spelling.
export function chaptersFromIndex(index: CubariSeries, kind: Series) {
	return pipe(
		Record.toEntries(index.chapters),
		Array.filterMap(entry =>
			pipe(
				Option.all({number: Schema.decodeOption(ChapterNumberFromString)(entry[0]), pages: pagesOf(index, entry[0])}),
				Option.map(found =>
					Chapter.make({
						...found,
						notified: true,
						postedAt: Boolean.match(kind === 'webcomic', {
							onFalse: () => pipe(entry[1].release_date, Option.map(Record.values), Option.flatMap(Array.head)),
							onTrue: () => Option.none()
						}),
						revisedAt: Option.none(),
						series: kind,
						source: `https://cubari.moe/read/gist/${INDEXES[kind]}/${entry[0]}/1/`,
						title: nameOf(Option.getOrElse(Option.flatten(entry[1].title), Function.constant('')))
					})
				),
				Result.fromOption(Function.constUndefined)
			)
		),
		Array.dedupeWith((left, right) => left.number === right.number)
	)
}
