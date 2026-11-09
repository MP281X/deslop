import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {findNotes} from '#services/notes/lib/search.ts'
import {Note} from '#services/notes/schema.ts'

it('finds notes that contain every word and carry every #tag', () => {
	const soup = Note.make({
		author: 'Lisa Kitchen',
		content: 'Lentils with cumin',
		createdAt: 0,
		id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
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
