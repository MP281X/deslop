import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {captureUrl, commentFor, findNotes, normalizeTags, tagCounts} from '#services/notes/lib/utils.ts'
import {Note} from '#services/notes/schema.ts'

it('maps every share of the same post to one canonical link', () => {
	assert.deepStrictEqual(
		Array.map(
			[
				'https://twitter.com/jack/status/20?s=20&t=abc',
				'look at this: https://mobile.x.com/jack/status/20.',
				'https://www.tiktok.com/@cook/video/123?_r=1&_t=8kx&is_from_webapp=1',
				'(https://example.com/read?id=7&utm_source=newsletter&fbclid=1#top)',
				'no link at all'
			],
			text => captureUrl(text) ?? 'no link'
		),
		[
			'https://x.com/jack/status/20',
			'https://x.com/jack/status/20',
			'https://www.tiktok.com/@cook/video/123',
			'https://example.com/read?id=7',
			'no link'
		]
	)
	assert.strictEqual(commentFor('Try this  https://x.com/a/status/1 \n tonight'), 'Try this tonight')
})

it('makes each tag one lowercase token', () => {
	assert.deepStrictEqual(normalizeTags(['#Web Design', 'web design', '  digital   marketing ', 'AI']), [
		'web-design',
		'digital-marketing',
		'ai'
	])
})

it('orders tags by how many notes use them, then by name', () => {
	const note = Note.make({
		author: 'Example',
		content: '',
		createdAt: 0,
		id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
		issue: '',
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

it('finds notes that contain every word and carry every #tag', () => {
	const soup = Note.make({
		author: 'Lisa Kitchen',
		content: 'Lentils with cumin',
		createdAt: 0,
		id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
		issue: '',
		source: 'TikTok',
		status: 'ready',
		summary: 'A quick dinner',
		tags: ['cooking', 'quick meals'],
		text: 'https://www.tiktok.com/@cook/video/123',
		title: 'Lentil soup',
		url: 'https://www.tiktok.com/@cook/video/123'
	})
	const article = Note.make({
		...soup,
		author: 'Spice Atlas',
		content: 'Cumin history',
		id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02',
		source: 'Website',
		tags: ['history'],
		text: 'https://example.com/cumin',
		title: 'Spice routes',
		url: 'https://example.com/cumin'
	})
	function found(query: string) {
		return Array.map(findNotes([soup, article], query), note => note.id)
	}
	assert.deepStrictEqual(found(''), [soup.id, article.id])
	assert.deepStrictEqual(found('CUMIN dinner'), [soup.id, article.id])
	assert.deepStrictEqual(found('cumin #history'), [article.id])
	assert.deepStrictEqual(found('#cook'), [])
	assert.deepStrictEqual(found('@cook lentil'), [soup.id])
	assert.deepStrictEqual(found('atlas'), [article.id])
})
