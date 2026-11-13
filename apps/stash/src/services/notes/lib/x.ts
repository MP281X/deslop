import {Array, HashMap, HashSet, Match, Option, Order, Predicate, Result, String, pipe} from 'effect'

import {canonical, plainText} from '#services/notes/lib/utils.ts'
import type {FxArticle, FxConversation, FxPost, TikTokPage} from '#services/notes/schema.ts'
import {Extraction} from '#services/notes/schema.ts'

const X_LINK = /^https?:\/\/(?:[\w-]+\.)?(?:x|twitter)\.com\//u

const byTime = Order.mapInput(Order.Number, (post: FxPost) => post.created_timestamp)

const byLikes = Order.mapInput(Order.flip(Order.Number), (post: FxPost) => post.likes ?? 0)

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
		url: canonical(url)
	})
}

// A block's entity ranges name entityMap entries by their key; links and code blocks live there.
function articleText(article: FxArticle) {
	// findFirst used the first entry when a source repeated a key.
	const entities = HashMap.fromIterable(
		Array.map(Array.reverse(article.content.entityMap), entity => [entity.key, entity] as const)
	)
	const lines = Array.filterMap(article.content.blocks, block => {
		const attached = Array.filterMap(block.entityRanges, range =>
			Result.fromOption(
				Option.flatMapNullishOr(
					HashMap.get(entities, `${range.key}`),
					entity => entity.value.data.markdown ?? entity.value.data.url
				),
				() => undefined
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
		pipe(
			replies,
			Array.filter(post => post.author.id === status.author.id),
			Array.sort(byTime)
		),
		Array.mapAccum(HashSet.make(status.id), (chain, post) => {
			if (!HashSet.has(chain, post.replying_to?.status ?? '')) return [chain, Option.none<FxPost>()] as const
			return [HashSet.add(chain, post.id), Option.some(post)] as const
		}),
		result => Array.getSomes(result[1])
	)
	const earlier = pipe(
		conversation.thread ?? [],
		Array.filter(post => post.id !== status.id),
		Array.sort(byTime)
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
				pipe(
					String.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/u)(link),
					Option.flatMap(match => Array.get(match, 1)),
					Result.fromOption(() => undefined)
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
		slides: pipe(photos, Array.drop(1), Array.take(30)),
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
							pipe(
								Option.fromNullishOr(answer.replying_to?.status),
								Option.flatMap(parentId => HashMap.get(plan.byId, parentId)),
								Option.match({
									onNone: () => plainText(answer.text),
									onSome: question =>
										`**${question.author.name} (@${question.author.screen_name})** wrote: ${plainText(question.text)}\nThe author answered: ${plainText(answer.text)}`
								})
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
		url: canonical(url),
		...pipe(
			// A clip with speech says more than a looping GIF beside it.
			Array.findFirst(media, item => item.type === 'video'),
			Option.orElse(() => Array.findFirst(media, item => item.type === 'gif')),
			Option.match({onNone: () => ({}), onSome: item => ({video: item.url})})
		)
	})
}
