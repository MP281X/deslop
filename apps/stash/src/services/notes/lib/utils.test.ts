import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {captureUrl, tagCounts} from '#services/notes/lib/utils.ts'
import {TagName} from '#services/notes/schema.ts'

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

it('orders tags by how many notes use them, then by name', () => {
	assert.deepStrictEqual(
		tagCounts([
			{tags: Array.map(['cooking', 'quick meals'], tag => TagName.make(tag))},
			{tags: Array.map(['cooking', 'history'], tag => TagName.make(tag))}
		]),
		[
			{count: 2, tag: 'cooking'},
			{count: 1, tag: 'history'},
			{count: 1, tag: 'quick meals'}
		]
	)
})
