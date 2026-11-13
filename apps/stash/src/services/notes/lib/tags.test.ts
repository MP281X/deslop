import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {normalizeTags, reconcileOrganization} from './tags.ts'

import {TagName} from '#services/notes/schema.ts'

it('makes each tag one lowercase token', () => {
	assert.deepStrictEqual(
		normalizeTags(Array.map(['#Web Design', 'web design', '  digital   marketing ', 'AI'], tag => TagName.make(tag))),
		['web-design', 'digital-marketing', 'ai']
	)
})

function organizedTags(tags: string[], inUse: string[]) {
	return Array.map(
		reconcileOrganization(
			{
				body: '',
				definitions: [],
				screenText: '',
				summary: '',
				tags: Array.map(tags, tag => TagName.make(tag)),
				title: 'Note',
				topics: ''
			},
			Array.map(inUse, tag => TagName.make(tag))
		).tags,
		tag => tag.name
	)
}

it('takes a plural or separator variant of a tag in use as that tag, but keeps a narrower tag apart', () => {
	assert.deepStrictEqual(
		organizedTags(['databases', 'webdesign', 'load-testing', 'security'], ['database', 'web-design', 'testing']),
		['database', 'web-design', 'load-testing', 'security']
	)
	assert.deepStrictEqual(organizedTags(['ios', 'c++', 'c#', 'aws', 'class'], ['io', 'c', 'aw', 'clas']), [
		'ios',
		'c++',
		'c#',
		'aws',
		'class'
	])
})
