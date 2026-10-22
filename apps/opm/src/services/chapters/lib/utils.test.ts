import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {nameOf, pageLink, postFrom, resumeOf, seriesOf} from '#services/chapters/lib/utils.ts'
import type {Reading} from '#services/chapters/schema.ts'
import {ChapterItem} from '#services/chapters/schema.ts'

const LINK = '<a href="https://cubari.moe/read/imgchest/abc123xyz/1/1/">[link]</a>'

it('reads English chapter posts and skips raws, the webcomic and posts without a reader link', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				{content: LINK, title: 'Chapter 242 [English]'},
				{content: LINK, title: '[Revised] Chapter 211 [English]'},
				{content: LINK, title: '[Webcomic] Chapter 160 [English]'},
				{content: LINK, title: 'RAW 243'},
				{content: 'no link here', title: 'Chapter 241 [English]'}
			],
			post =>
				Option.map(postFrom({...post, published: '2026-10-21T15:27:52+00:00'}), found => [found.number, found.revised])
		),
		[Option.some([242, false]), Option.some([211, true]), Option.none(), Option.none(), Option.none()]
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
			pageLink
		),
		[Option.some('https://files.example.org/a.png'), Option.none(), Option.some('https://i.example.org/b.png')]
	)
	assert.strictEqual(nameOf('Chapter 225: New Blood 3'), 'New Blood 3')
	assert.strictEqual(nameOf('One Punch Man Chapter 242'), '')
	assert.strictEqual(nameOf('Translated'), '')
})

function unread(number: number) {
	return ChapterItem.make({number, pages: [], postedAt: 0, source: '', title: ''})
}

function read(number: number, reading: Reading) {
	return ChapterItem.make({...unread(number), reading})
}

it('resumes the chapter read last, then the next unread one, and nothing once caught up', () => {
	assert.deepStrictEqual(
		resumeOf([read(240, {at: 1, done: true, page: 17}), read(241, {at: 2, done: false, page: 6}), unread(242)]),
		Option.some({number: 241, page: 6})
	)
	assert.deepStrictEqual(
		resumeOf([read(240, {at: 2, done: true, page: 17}), unread(241), unread(242)]),
		Option.some({number: 241, page: 0})
	)
	assert.deepStrictEqual(resumeOf([read(241, {at: 1, done: true, page: 9})]), Option.none())
	assert.deepStrictEqual(resumeOf([unread(241), unread(242)]), Option.none())
})
