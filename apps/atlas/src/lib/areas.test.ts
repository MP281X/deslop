import {assert, it} from '@effect/vitest'

import {churnByArea, areaOf} from '#lib/areas.ts'
import {FileChange} from '#services/changes/schema.ts'

it('groups a workspace path by its root and second segment', () => {
	assert.strictEqual(areaOf('apps/atlas/src/lib/utils.ts'), 'apps/atlas')
	assert.strictEqual(areaOf('packages/runtime/src/cli/service.ts'), 'packages/runtime')
	assert.strictEqual(areaOf('tools/create-app/template/web/index.html'), 'tools/create-app')
})

it('keeps a root file at the root and groups another path by its first segment', () => {
	assert.strictEqual(areaOf('README.md'), '(root)')
	assert.strictEqual(areaOf('src/index.ts'), 'src')
})

it('sums churn per area and orders by total churn, then name', () => {
	const files = [
		FileChange.make({additions: 1, deletions: 1, path: 'packages/b/x.ts', state: 'modified'}),
		FileChange.make({additions: 3, deletions: 0, path: 'apps/z/y.ts', state: 'modified'}),
		FileChange.make({additions: 3, deletions: 0, path: 'apps/a/z.ts', state: 'modified'}),
		FileChange.make({additions: 3, deletions: 0, path: 'apps/a/y.ts', state: 'modified'}),
		FileChange.make({additions: 3, deletions: 0, path: 'apps/b/x.ts', state: 'modified'})
	]
	assert.deepStrictEqual(churnByArea(files), [
		{additions: 6, area: 'apps/a', deletions: 0, files: 2},
		{additions: 3, area: 'apps/b', deletions: 0, files: 1},
		{additions: 3, area: 'apps/z', deletions: 0, files: 1},
		{additions: 1, area: 'packages/b', deletions: 1, files: 1}
	])
})
