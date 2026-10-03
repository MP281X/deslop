import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {findNotes, parseTags} from '#lib/utils.ts'
import {Note} from '#services/notes/schema.ts'

it('matches AND words across saved fields together with exact tag filters', () => {
	const recipe = Note.make({
		content: 'Ginger',
		createdAt: 0,
		id: 'recipe',
		issue: '',
		raw: 'Original garlic instructions',
		source: 'TikTok',
		status: 'ready',
		summary: 'Dinner',
		tags: ['quick meals'],
		title: 'Noodles',
		url: 'https://www.tiktok.com/@cook/video/123'
	})
	const other = {...recipe, id: 'other', source: 'Website' as const, tags: ['quick'], title: 'Different'}
	const notes = [recipe, other]
	assert.deepStrictEqual(
		Array.map(
			findNotes(notes, {query: ' NOODLES dinner ginger garlic cook meals ', tag: 'quick meals'}),
			note => note.id
		),
		['recipe']
	)
	assert.deepStrictEqual(findNotes(notes, {query: 'noodles missing', tag: ''}), [])
	assert.deepStrictEqual(
		Array.map(findNotes(notes, {query: '', tag: 'quick meals'}), note => note.id),
		['recipe']
	)
	assert.deepStrictEqual(
		Array.map(findNotes(notes, {query: '  ', tag: ''}), note => note.id),
		['recipe', 'other']
	)
})

it('normalizes comma-separated edits without empty or duplicate tags', () => {
	assert.deepStrictEqual(parseTags(' recipes, , quick meals, recipes,quick meals, Gardening, '), [
		'recipes',
		'quick meals',
		'Gardening'
	])
})
