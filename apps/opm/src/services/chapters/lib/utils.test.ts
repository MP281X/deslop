import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {notificationOf, postFrom} from '#services/chapters/lib/utils.ts'
import {ChapterNumber} from '#services/chapters/schema.ts'

const LINK = '<a href="https://cubari.moe/read/imgchest/abc123xyz/1/1/">[link]</a>'

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
