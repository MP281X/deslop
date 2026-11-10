import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {captureUrl, commentFor, hasVideo, tagCounts} from '#services/notes/lib/utils.ts'
import {Note} from '#services/notes/schema.ts'

it('maps every share of the same post to one canonical link', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				'https://twitter.com/jack/status/20?s=20&t=abc',
				'look at this: https://mobile.x.com/jack/status/20.',
				'https://www.tiktok.com/@cook/video/123?_r=1&_t=8kx&is_from_webapp=1',
				'(https://example.com/read?id=7&utm_source=newsletter&fbclid=1#top)',
				'https://en.wikipedia.org/wiki/Rust_(programming_language).',
				'https://youtube.com/watch?v=USeyDcWyVCc&is=h9EZv_PNBm9nlsvD',
				'https://youtu.be/USeyDcWyVCc?is=DMulhHhr4EoyJbVC',
				'https://m.youtube.com/watch?v=USeyDcWyVCc&t=42s',
				'https://www.youtube.com/shorts/LX_f1wuxFFQ?si=abc',
				'no link at all'
			],
			text => captureUrl(text) ?? 'no link'
		),
		[
			'https://x.com/jack/status/20',
			'https://x.com/jack/status/20',
			'https://www.tiktok.com/@cook/video/123',
			'https://example.com/read?id=7',
			'https://en.wikipedia.org/wiki/Rust_(programming_language)',
			'https://www.youtube.com/watch?v=USeyDcWyVCc',
			'https://www.youtube.com/watch?v=USeyDcWyVCc',
			'https://www.youtube.com/watch?v=USeyDcWyVCc',
			'https://www.youtube.com/watch?v=LX_f1wuxFFQ',
			'no link'
		]
	)
})

it('keeps the words around a shared link as its comment', () => {
	assert.strictEqual(commentFor('Try this  https://x.com/a/status/1 \n tonight'), 'Try this tonight')
})

it('reads the video of a TikTok, but not of its photo posts', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				'https://www.tiktok.com/@cook/video/123',
				'https://www.tiktok.com/@cook/photo/123',
				'https://vm.tiktok.com/ZN8Bp9ayx/',
				'https://x.com/jack/status/20',
				'https://www.instagram.com/reel/not-supported/',
				'https://example.com/read'
			],
			hasVideo
		),
		[true, false, true, true, false, false]
	)
})

it('orders tags by how many notes use them, then by name', () => {
	const note = Note.make({
		author: 'Example',
		content: '',
		createdAt: 0,
		id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
		source: 'Website',
		status: 'ready',
		summary: '',
		tags: ['cooking', 'quick meals'],
		text: 'https://example.com/soup',
		title: 'Lentil soup',
		url: 'https://example.com/soup'
	})
	assert.deepStrictEqual(tagCounts([note, {...note, tags: ['cooking', 'history']}]), [
		{count: 2, tag: 'cooking'},
		{count: 1, tag: 'history'},
		{count: 1, tag: 'quick meals'}
	])
})
