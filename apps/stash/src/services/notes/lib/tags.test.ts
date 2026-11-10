import {assert, it} from '@effect/vitest'

import {normalizeTags, reconcileOrganization} from '#services/notes/lib/tags.ts'

it('makes each tag one lowercase token', () => {
	assert.deepStrictEqual(normalizeTags(['#Web Design', 'web design', '  digital   marketing ', 'AI']), [
		'web-design',
		'digital-marketing',
		'ai'
	])
})

function organizedTags(tags: string[], inUse: string[]) {
	return reconcileOrganization(
		{body: '', definitions: [], screenText: '', summary: '', tags, title: 'Note', topics: ''},
		inUse,
		{}
	).organization.tags
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
