import {
	Array,
	Function,
	HashMap,
	HashSet,
	Match,
	Option,
	Order,
	Predicate,
	Record,
	Result,
	String,
	Struct,
	pipe
} from 'effect'

import type {
	Note,
	NotesEvent,
	Organization,
	FxArticle,
	FxPost,
	FxConversation,
	TikTokPage,
	TagDefinition
} from '#services/notes/schema.ts'
import {Extraction} from '#services/notes/schema.ts'

const X_LINK = /^https?:\/\/(?:[\w-]+\.)?(?:x|twitter)\.com\//u

const URL_PATTERN = /https?:\/\/[^\s<>"]+/iu

const X_HOSTS = ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']

const TRACKING_PARAMETERS = [
	'fbclid',
	'gclid',
	'igsh',
	'igshid',
	'mc_cid',
	'mc_eid',
	'si',
	'utm_campaign',
	'utm_content',
	'utm_id',
	'utm_medium',
	'utm_source',
	'utm_term'
]

const byTime = Order.mapInput(Order.Number, (post: FxPost) => post.created_timestamp)

const byLikes = Order.mapInput(Order.flip(Order.Number), (post: FxPost) => post.likes ?? 0)

function withoutTrailingPunctuation(link: string): string {
	const trimmed = String.replace(/[.,;:!?\]]+$/u, '')(link)
	if (String.endsWith(')')(trimmed) && String.split(trimmed, ')').length > String.split(trimmed, '(').length) {
		return withoutTrailingPunctuation(String.slice(0, -1)(trimmed))
	}
	return trimmed
}

// youtu.be, Shorts, live and embed links and the mobile site all name one video by its id.
function youTubeId(url: URL) {
	if (url.hostname === 'youtu.be') return Array.findFirst(String.split(url.pathname, '/'), String.isNonEmpty)
	if (Option.isNone(String.match(/(?:^|\.)youtube\.com$/u)(url.hostname))) return Option.none<string>()
	return pipe(
		Option.fromNullishOr(url.searchParams.get('v')),
		Option.orElse(() =>
			pipe(
				String.match(/^\/(?:shorts|live|embed)\/([\w-]+)/u)(url.pathname),
				Option.flatMap(match => Array.get(match, 1))
			)
		)
	)
}

export function sourceFor(url: string) {
	const host = new URL(url).hostname
	if (Array.contains(X_HOSTS, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

function withoutTracking(link: string) {
	const url = new URL(link)
	if (Array.contains(X_HOSTS, url.hostname)) url.hostname = 'x.com'
	if (sourceFor(url.href) === 'Website') {
		for (const key of TRACKING_PARAMETERS) url.searchParams.delete(key)
	} else {
		url.search = ''
	}
	url.hash = ''
	return url.href
}

function canonicalUrl(link: string) {
	return Option.match(youTubeId(new URL(link)), {
		onNone: () => withoutTracking(link),
		onSome: id => `https://www.youtube.com/watch?v=${id}`
	})
}

export function captureUrl(text: string) {
	return pipe(
		String.match(URL_PATTERN)(text),
		Option.flatMap(Array.head),
		Option.map(withoutTrailingPunctuation),
		Option.flatMap(Option.liftThrowable(canonicalUrl)),
		Option.getOrUndefined
	)
}

export function isYouTube(url: string) {
	return Option.isSome(String.match(/(?:^|\.)(?:youtube\.com|youtu\.be)$/u)(new URL(url).hostname))
}

export function hasVideo(url: string) {
	const link = new URL(url)
	if (sourceFor(url) === 'TikTok') return !String.includes('/photo/')(link.pathname)
	return sourceFor(url) === 'X' || isYouTube(url)
}

export function plainText(text: string) {
	return pipe(text, String.replaceAll(/\s+/gu, ' '), String.trim)
}

export function commentFor(text: string) {
	return pipe(text, String.replaceAll(new RegExp(URL_PATTERN.source, 'giu'), ''), plainText)
}

export function normalizeTags(tags: Note['tags']) {
	return pipe(
		tags,
		Array.map(tag => pipe(tag, String.toLowerCase, plainText, String.replace(/^#+/u, ''), String.replaceAll(' ', '-'))),
		Array.filter(String.isNonEmpty),
		Array.dedupe
	)
}

// `+` and `#` name languages (c, c++, c#), and a word of three letters or fewer keeps its s (ios, aws).
function tagKey(tag: string) {
	return pipe(tag, String.replaceAll(/[^a-z0-9+#]/gu, ''), String.replace(/^(.{2,}[^s])s$/u, '$1'))
}

function reuseTags(tags: Note['tags'], existing: Note['tags']) {
	const byKey = Array.groupBy(existing, tagKey)
	return Array.dedupe(
		Array.map(tags, tag =>
			pipe(
				Array.head(byKey[tagKey(tag)] ?? []),
				Option.getOrElse(() => tag)
			)
		)
	)
}

export function reconcileOrganization(organization: Organization, inUse: string[], known: Record<string, string>) {
	const tags = reuseTags(organization.tags, inUse)
	return {
		definitions: pipe(
			organization.definitions,
			Array.map(item =>
				pipe(
					Array.head(reuseTags(normalizeTags([item.tag]), inUse)),
					Option.map(name => ({definition: plainText(item.definition), tag: name}))
				)
			),
			Array.getSomes,
			Array.filter(item => Array.contains(tags, item.tag) && !Record.has(known, item.tag))
		),
		organization: {...Struct.omit(organization, ['definitions']), tags}
	}
}

export function reconcileDefinitions(entries: TagDefinition[], known: Record<string, string>) {
	const definitions = {
		...Record.fromEntries(
			Array.map(
				Array.dedupeWith(entries, (left, right) => left.tag === right.tag),
				entry => [entry.tag, entry.definition] as const
			)
		),
		...known
	}
	return {definitions, rows: Array.map(Record.toEntries(definitions), pair => ({definition: pair[1], tag: pair[0]}))}
}

export function tikTokExtraction(
	item: TikTokPage['__DEFAULT_SCOPE__']['webapp.video-detail']['itemInfo']['itemStruct'],
	url: URL
) {
	const images = Array.filterMap(item.imagePost.images, image =>
		Result.fromOption(Array.head(image.imageURL.urlList), () => undefined)
	)
	return Extraction.make({
		author: Option.some(item.author.nickname),
		image: Array.head(images),
		slides: Array.drop(images, 1),
		text: pipe(
			[item.imagePost.title, item.desc],
			Array.filter(Predicate.isNotUndefined),
			Array.map(plainText),
			Array.filter(String.isNonEmpty),
			Array.join('\n')
		),
		title: `${item.author.nickname} on TikTok`,
		url: captureUrl(url.href) ?? url.href
	})
}

// A block's entity ranges name entityMap entries by their key; links and code blocks live there.
function articleText(article: FxArticle) {
	// findFirst used the first entry when a source repeated a key.
	const entities = HashMap.fromIterable(
		Array.map(Array.reverse(article.content.entityMap), entity => [entity.key, entity] as const)
	)
	const lines = Array.filterMap(article.content.blocks, block => {
		const attached = pipe(
			block.entityRanges,
			Array.filterMap(range =>
				Result.fromOption(
					pipe(
						HashMap.get(entities, `${range.key}`),
						Option.flatMapNullishOr(entity => entity.value.data.markdown ?? entity.value.data.url)
					),
					() => undefined
				)
			)
		)
		const text = pipe([String.trim(block.text), ...attached], Array.filter(String.isNonEmpty), Array.join(' '))
		if (String.isEmpty(text)) return Result.failVoid
		return Result.succeed(
			pipe(
				Match.value(block.type),
				Match.when('header-one', () => `# ${text}`),
				Match.when('header-two', () => `## ${text}`),
				Match.when('header-three', () => `### ${text}`),
				Match.when('unordered-list-item', () => `- ${text}`),
				Match.when('ordered-list-item', () => `1. ${text}`),
				Match.when('blockquote', () => `> ${text}`),
				Match.orElse(() => text)
			)
		)
	})
	return `# ${article.title}\n\n${Array.join(lines, '\n\n')}`
}

function said(post: FxPost) {
	return pipe(
		[
			`**${post.author.name} (@${post.author.screen_name})**: ${plainText(post.text)}`,
			Option.match(Option.fromNullishOr(post.article), {onNone: () => '', onSome: articleText})
		],
		Array.filter(String.isNonEmpty),
		Array.join('\n\n')
	)
}

function section(title: string, entries: string[]) {
	if (Array.isReadonlyArrayEmpty(entries)) return ''
	return `## ${title}\n\n${Array.join(entries, '\n\n')}`
}

function photosOf(post: FxPost) {
	return [
		...pipe(
			post.media?.all ?? [],
			Array.filter(item => item.type === 'photo'),
			Array.map(item => item.url)
		),
		...Array.getSomes(
			Array.map(post.article?.media_entities ?? [], entity =>
				Option.fromUndefinedOr(entity.media_info.original_img_url)
			)
		)
	]
}

export function conversationPlan(conversation: FxConversation, status: FxPost, quote: Option.Option<FxPost>) {
	const replies = conversation.replies ?? []
	const byId = HashMap.fromIterable(Array.map(Array.reverse(replies), post => [post.id, post] as const))
	// The author's follow-ups answer the saved post or an earlier follow-up; the author's answers to readers stay replies.
	const followUps = pipe(
		Array.sort(
			Array.filter(replies, post => post.author.id === status.author.id),
			byTime
		),
		Array.mapAccum(HashSet.make(status.id), (chain, post) => {
			if (!HashSet.has(chain, post.replying_to?.status ?? '')) return [chain, Option.none<FxPost>()] as const
			return [HashSet.add(chain, post.id), Option.some(post)] as const
		}),
		result => Array.getSomes(result[1])
	)
	const earlier = Array.sort(
		Array.filter(conversation.thread ?? [], post => post.id !== status.id),
		byTime
	)
	const shown = [status, ...followUps, ...Option.toArray(quote)]
	// The posts above the saved one come after it, so its own links and photos lead.
	const context = [...shown, ...earlier]
	const contextIds = HashSet.fromIterable(Array.map(context, post => post.id))
	const followUpIds = HashSet.fromIterable(Array.map(followUps, post => post.id))
	const links = Array.dedupe(
		Array.flatMap(context, post =>
			Array.getSomes(Array.map(post.raw_text?.facets ?? [], facet => Option.fromUndefinedOr(facet.replacement)))
		)
	)
	return {
		byId,
		context,
		earlier,
		followUpIds,
		followUps,
		pages: pipe(
			links,
			Array.filter(link => !X_LINK.test(link)),
			Array.filterMap(link => Result.fromOption(Option.liftThrowable(() => new URL(link))(), () => undefined)),
			Array.take(3)
		),
		posts: pipe(
			links,
			Array.filterMap(link =>
				Result.fromOption(
					pipe(
						String.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/u)(link),
						Option.flatMap(match => Array.get(match, 1))
					),
					() => undefined
				)
			),
			Array.filter(linkedId => !HashSet.has(contextIds, linkedId)),
			Array.dedupe,
			Array.take(5)
		),
		quote,
		replies,
		shown,
		status
	}
}

export function conversationExtraction(
	url: URL,
	plan: ReturnType<typeof conversationPlan>,
	linked: {pages: Option.Option<string>[]; posts: Option.Option<FxPost>[]}
) {
	const posts = Array.getSomes(linked.posts)
	const media = Array.flatMap(plan.shown, post => post.media?.all ?? [])
	const photos = Array.dedupe(Array.flatMap([...plan.context, ...posts], photosOf))
	return Extraction.make({
		author: Option.some(plan.status.author.name),
		image: Option.orElse(Array.head(photos), () =>
			Option.map(Array.head(media), item => item.thumbnail_url ?? item.url)
		),
		slides: Array.take(Array.drop(photos, 1), 30),
		text: pipe(
			[
				section('Earlier in the conversation', Array.map(plan.earlier, said)),
				said(plan.status),
				...Array.map(plan.followUps, post => plainText(post.text)),
				Option.match(plan.quote, {onNone: () => '', onSome: post => `Quoting ${said(post)}`}),
				section('Linked posts', Array.map(posts, said)),
				section('Linked pages', Array.getSomes(linked.pages)),
				section(
					"The author's answers to readers",
					pipe(
						plan.replies,
						Array.filter(post => post.author.id === plan.status.author.id && !HashSet.has(plan.followUpIds, post.id)),
						Array.sort(byTime),
						Array.map(answer =>
							Option.match(
								Option.flatMap(Option.fromNullishOr(answer.replying_to?.status), parentId =>
									HashMap.get(plan.byId, parentId)
								),
								{
									onNone: () => plainText(answer.text),
									onSome: question =>
										`**${question.author.name} (@${question.author.screen_name})** wrote: ${plainText(question.text)}\nThe author answered: ${plainText(answer.text)}`
								}
							)
						)
					)
				),
				section(
					'Replies',
					pipe(
						plan.replies,
						Array.filter(post => post.author.id !== plan.status.author.id),
						Array.sort(byLikes),
						Array.take(40),
						// Likes tell the AI which replies readers agreed with.
						Array.map(
							post =>
								`**${post.author.name} (@${post.author.screen_name})**${Option.match(
									Option.fromUndefinedOr(post.likes),
									{onNone: () => '', onSome: likes => `, ${likes} likes`}
								)}: ${plainText(post.text)}`
						)
					)
				)
			],
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: `${plan.status.author.name} on X`,
		url: captureUrl(url.href) ?? url.href,
		...pipe(
			// A clip with speech says more than a looping GIF beside it.
			Array.findFirst(media, item => item.type === 'video'),
			Option.orElse(() => Array.findFirst(media, item => item.type === 'gif')),
			Option.match({onNone: () => ({}), onSome: item => ({video: item.url})})
		)
	})
}

export function tagCounts(notes: NotesEvent['upserted']) {
	return pipe(
		Array.flatMap(notes, note => note.tags),
		Array.groupBy(Function.identity),
		Record.toEntries,
		Array.map(entry => ({count: entry[1].length, tag: entry[0]})),
		Array.sort(
			Order.combine(
				Order.mapInput(Order.flip(Order.Number), (entry: {count: number; tag: string}) => entry.count),
				Order.mapInput(Order.String, (entry: {count: number; tag: string}) => entry.tag)
			)
		)
	)
}

export function findNotes(notes: Note[], query: string) {
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	const tags = pipe(
		words,
		Array.filter(String.startsWith('#')),
		Array.map(String.slice(1)),
		Array.filter(String.isNonEmpty)
	)
	const terms = Array.filter(words, word => !String.startsWith('#')(word))
	if (Array.isReadonlyArrayEmpty(words)) return notes
	return Array.filter(notes, note => {
		if (!Array.every(tags, tag => Array.contains(note.tags, tag))) return false
		const haystack = pipe(
			[
				note.title,
				note.summary,
				note.author,
				note.text,
				note.content,
				note.topics,
				note.body,
				note.screenText,
				note.transcript,
				note.url,
				...note.tags
			],
			Array.filter(Predicate.isNotUndefined),
			Array.join(' '),
			String.toLowerCase
		)
		return Array.every(terms, term => String.includes(term)(haystack))
	})
}
