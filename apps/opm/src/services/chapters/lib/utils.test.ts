import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {nameOf, notificationOf, pagesOf, postFrom, resumeOf, seriesOf} from '#services/chapters/lib/utils.ts'
import type {Reading} from '#services/chapters/schema.ts'
import {ChapterItem} from '#services/chapters/schema.ts'

const LINK = '<a href="https://cubari.moe/read/imgchest/abc123xyz/1/1/">[link]</a>'

it('routes series-qualified notifications and keeps previously delivered manga targets', () => {
	assert.deepStrictEqual(notificationOf({path: 'webcomic:161'}), Option.some({number: 161, series: 'webcomic'}))
	assert.deepStrictEqual(notificationOf({path: 'manga:44.5'}), Option.some({number: 44.5, series: 'manga'}))
	assert.deepStrictEqual(notificationOf({chapter: 161}), Option.some({number: 161, series: 'manga'}))
	assert.deepStrictEqual(notificationOf({path: 'unknown:161'}), Option.none())
	assert.deepStrictEqual(notificationOf(undefined), Option.none())
})

it('classifies English manga and webcomic releases, preserving revisions and skipping raws and discussion', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				{content: LINK, title: 'Chapter 242 [English]'},
				{content: LINK, title: '[Revised] Chapter 211 [English]'},
				{content: LINK, title: '[Webcomic] Chapter 160 [English]'},
				{content: LINK, title: '[Webcomic] [Revised] Chapter 159 [English]'},
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
			Option.some(['webcomic', 160, false]),
			Option.some(['webcomic', 159, true]),
			Option.none(),
			Option.none(),
			Option.none(),
			Option.none()
		]
	)
	assert.deepStrictEqual(
		seriesOf('https://cubari.moe/read/gist/OPM/225/1/'),
		Option.some({api: 'https://cubari.moe/read/api/gist/series/OPM/', chapter: '225'})
	)
})

it('unwraps pages of the dead image proxy and drops its error texts', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				`https://services.f-ck.me/v1/image/${btoa('https://files.example.org/a.png')}`,
				`https://services.f-ck.me/v1/image/${btoa('Invalid uploader')}`,
				{src: 'https://i.example.org/b.png'}
			],
			page => pagesOf({chapters: {'1': {groups: {english: [page]}}}}, '1')
		),
		[Option.some(['https://files.example.org/a.png']), Option.none(), Option.some(['https://i.example.org/b.png'])]
	)
	assert.strictEqual(nameOf('Chapter 225: New Blood 3'), 'New Blood 3')
	assert.strictEqual(nameOf('One Punch Man Chapter 242'), '')
	assert.strictEqual(nameOf('Translated'), '')
	assert.strictEqual(nameOf('OPM WC 160'), '')
	assert.strictEqual(nameOf('OPM (Webcomic) - Chapter 158 - The Koi Pond'), 'The Koi Pond')
})

function unread(number: number) {
	return ChapterItem.make({number, pages: [], postedAt: 0, series: 'manga', source: '', title: ''})
}

function read(number: number, reading: Reading) {
	return ChapterItem.make({...unread(number), reading})
}

it('reopens the last-read chapter even when finished or caught up, and has no resume before any reading', () => {
	assert.deepStrictEqual(
		resumeOf([read(240, {at: 1, done: true, page: 17}), read(241, {at: 2, done: false, page: 6}), unread(242)]),
		Option.some({number: 241, page: 6})
	)
	assert.deepStrictEqual(
		resumeOf([read(240, {at: 2, done: true, page: 17}), unread(241), unread(242)]),
		Option.some({number: 240, page: 17})
	)
	assert.deepStrictEqual(resumeOf([read(241, {at: 1, done: true, page: 9})]), Option.some({number: 241, page: 9}))
	assert.deepStrictEqual(resumeOf([unread(241), unread(242)]), Option.none())
	assert.deepStrictEqual(resumeOf([read(242, {at: 0, done: true, page: 17})]), Option.none())
})
