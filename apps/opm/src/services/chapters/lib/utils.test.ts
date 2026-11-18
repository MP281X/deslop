import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option, Struct} from 'effect'

import {
	chaptersFromIndex,
	keyOf,
	missingRanges,
	notificationOf,
	postFrom,
	revisionCandidates,
	roundChapters
} from '#services/chapters/lib/utils.ts'
import {Chapter, ChapterNumber, Post} from '#services/chapters/schema.ts'
import type {Series} from '#services/chapters/schema.ts'

const LINK = '<a href="https://cubari.moe/read/imgchest/abc123xyz/1/1/">[link]</a>'

function redditPost(number: number, revised: boolean, at: string, link: string) {
	return Post.make({
		links: [link],
		number: ChapterNumber.make(number),
		postedAt: DateTime.makeUnsafe(at),
		revised,
		series: 'manga'
	})
}

function chapter(series: Series, number: number, notified: boolean, postedAt = Option.none<DateTime.Utc>()) {
	return Chapter.make({
		notified,
		number: ChapterNumber.make(number),
		pages: ['https://example.com/page.png'],
		postedAt,
		revisedAt: Option.none(),
		series,
		source: `https://cubari.moe/read/gist/JYHJU/${number}/1/`,
		title: ''
	})
}

it('announces index releases above the series high while silently filling gaps and keeping known chapters', () => {
	assert.deepStrictEqual(
		roundChapters(
			[chapter('webcomic', 156, true), chapter('webcomic', 158, true), chapter('manga', 243, true)],
			[],
			[
				{
					chapters: Array.map([155, 156, 157, 158, 159, 160], number => chapter('webcomic', number, true)),
					kind: 'webcomic'
				}
			]
		).backfilled,
		[chapter('webcomic', 157, true), chapter('webcomic', 159, false), chapter('webcomic', 160, false)]
	)
})

it('routes series-qualified notifications', () => {
	assert.deepStrictEqual(
		notificationOf({path: 'webcomic:161'}),
		Option.some({number: ChapterNumber.make(161), series: 'webcomic'})
	)
	assert.deepStrictEqual(
		notificationOf({path: 'manga:44.5'}),
		Option.some({number: ChapterNumber.make(44.5), series: 'manga'})
	)
	assert.deepStrictEqual(notificationOf({path: 'unknown:161'}), Option.none())
	assert.deepStrictEqual(notificationOf(undefined), Option.none())
})

it('classifies English manga and webcomic releases, preserving revisions and skipping raws and discussion', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				{content: LINK, title: 'Chapter 242 [English]'},
				{content: LINK, title: '[Revised] Chapter 211 [English]'},
				{content: LINK, title: '[Revised] Chapter 210 [English]'},
				{content: LINK, title: '[New Revised] Chapter 202 [English]'},
				{content: LINK, title: '[New Revised] Chapter 198 [English]'},
				{content: LINK, title: '[New Revised] Chapter 196 [English]'},
				{content: LINK, title: '[Revised II] Chapter 198/243 [English]'},
				{content: LINK, title: '[Revised II] Chapter 202/247 [English]'},
				{content: LINK, title: '[Webcomic] Chapter 160 [English]'},
				{content: LINK, title: '[Webcomic] [Revised] Chapter 159 [English]'},
				{content: LINK, title: 'Chapter 237/282 [English]'},
				{content: LINK, title: 'Chapter 242/287 [Translations]'},
				{content: LINK, title: '[Webcomic] Chapter 160 [RAW]'},
				{content: LINK, title: '[OC] Webcomic Chapter 160'},
				{content: LINK, title: 'RAW 243'},
				{content: 'no link here', title: 'Chapter 241 [English]'}
			],
			post =>
				Option.map(postFrom({...post, published: '2026-10-21T15:27:52+00:00'}), found => [
					found.series,
					found.number,
					found.revised
				])
		),
		[
			Option.some(['manga', 242, false]),
			Option.some(['manga', 211, true]),
			Option.some(['manga', 210, true]),
			Option.some(['manga', 202, true]),
			Option.some(['manga', 198, true]),
			Option.some(['manga', 196, true]),
			Option.some(['manga', 198, true]),
			Option.some(['manga', 202, true]),
			Option.some(['webcomic', 160, false]),
			Option.some(['webcomic', 159, true]),
			Option.some(['manga', 237, false]),
			Option.some(['manga', 242, false]),
			Option.none(),
			Option.none(),
			Option.none(),
			Option.none()
		]
	)
})

it('reads the reader links and publication time of a post', () => {
	assert.deepStrictEqual(
		Option.map(
			postFrom({
				content: `${LINK} <a href="https://cubari.moe/read/gist/OPM/242/1/">mirror</a> ${LINK}`,
				published: '2026-10-21T15:27:52+00:00',
				title: 'Chapter 242 [English]'
			}),
			found => [found.links, DateTime.formatIso(found.postedAt)]
		),
		Option.some([
			['https://cubari.moe/read/imgchest/abc123xyz/1', 'https://cubari.moe/read/gist/OPM/242'],
			'2026-10-21T15:27:52.000Z'
		])
	)
})

it('reads an index chapter once per number, from its first translated group of https pages', () => {
	const group = {English: ['https://example.com/en.png']}
	assert.deepStrictEqual(
		Array.map(
			chaptersFromIndex(
				{
					chapters: {
						'1e12': {groups: group, release_date: Option.none(), title: Option.none()},
						'123suffix': {groups: group, release_date: Option.none(), title: Option.none()},
						'243.5': {groups: group, release_date: Option.none(), title: Option.none()},
						'243.50': {groups: group, release_date: Option.none(), title: Option.none()},
						'244': {
							groups: {Japanese: ['https://example.com/jp.png'], ...group},
							release_date: Option.none(),
							title: Option.none()
						},
						'245': {
							groups: {English: ['http://example.com/en.png']},
							release_date: Option.none(),
							title: Option.none()
						},
						Infinity: {groups: group, release_date: Option.none(), title: Option.none()},
						NaN: {groups: group, release_date: Option.none(), title: Option.none()}
					}
				},
				'manga'
			),
			found => `${found.number} ${Array.join(found.pages, ' ')}`
		),
		['244 https://example.com/en.png', '243.5 https://example.com/en.png']
	)
})

function only(page: string) {
	return {groups: {English: [page]}, release_date: Option.none(), title: Option.none()}
}

it('drops a chapter none of whose pages the reader would load', () => {
	assert.deepStrictEqual(
		Array.map(
			chaptersFromIndex(
				{
					chapters: {
						'1': only('https://example.com/ok.png'),
						'2': only('https://localhost/private.png'),
						'3': only('https://127.0.0.1/private.png'),
						'4': only('https://93.184.216.34/page.png'),
						'5': only('https://[::1]/private.png'),
						'6': only('https://printer.local/page.png'),
						'7': only('https://cdn.localhost/page.png')
					}
				},
				'manga'
			),
			found => found.number
		),
		[1]
	)
})

it('reports each run of missing whole numbers once, however far apart its neighbours', () => {
	assert.deepStrictEqual(
		missingRanges(
			Array.map([230, 233, 233.5, 234, 1e12], number => chapter('manga', number, true)),
			'manga'
		),
		[
			{from: 231, to: 232},
			{from: 235, to: 1e12 - 1}
		]
	)
	assert.deepStrictEqual(missingRanges([chapter('manga', 243.5, true)], 'manga'), [])
})

it('tries the first post of a new chapter and the newest revision of a known one first', () => {
	assert.deepStrictEqual(
		Array.map(
			revisionCandidates(
				[
					redditPost(244, false, '2026-11-18T09:00:00Z', 'https://cubari.moe/read/imgchest/first/'),
					redditPost(244, false, '2026-11-18T10:00:00Z', 'https://cubari.moe/read/imgchest/repost/'),
					redditPost(243, true, '2026-11-18T09:01:00Z', 'https://cubari.moe/read/imgchest/older/'),
					redditPost(243, true, '2026-11-18T09:02:00Z', 'https://cubari.moe/read/imgchest/newer/')
				],
				[chapter('manga', 243, true, Option.some(DateTime.makeUnsafe('2026-11-01T00:00:00Z')))],
				[]
			),
			group => [group[0], Array.map(group[1], candidate => candidate.links[0])]
		),
		[
			[
				keyOf({number: ChapterNumber.make(244), series: 'manga'}),
				['https://cubari.moe/read/imgchest/first/', 'https://cubari.moe/read/imgchest/repost/']
			],
			[
				keyOf({number: ChapterNumber.make(243), series: 'manga'}),
				['https://cubari.moe/read/imgchest/newer/', 'https://cubari.moe/read/imgchest/older/']
			]
		]
	)
})

it('keeps the pages Reddit brings in the round the index brings the same chapter', () => {
	const fromReddit = Chapter.make({
		...Struct.pick(chapter('manga', 244, false), Struct.keys(Chapter.fields)),
		pages: ['https://example.com/reddit.png']
	})
	assert.deepStrictEqual(
		roundChapters(
			[],
			[fromReddit],
			[{chapters: [chapter('manga', 243, true), chapter('manga', 244, true)], kind: 'manga'}]
		),
		{backfilled: [chapter('manga', 243, true)], fresh: [fromReddit], revisions: []}
	)
})
