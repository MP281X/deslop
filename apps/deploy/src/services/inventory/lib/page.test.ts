import {assert, it} from '@effect/vitest'

import {sourceBelongsToWorker} from '#services/inventory/lib/page.ts'

it('matches a worker’s bare or prefixed source and no other worker’s', () => {
	assert.isTrue(sourceBelongsToWorker({name: 'desktop'}, 'desktop'))
	assert.isFalse(sourceBelongsToWorker({name: 'desktop'}, 'dev'))
	assert.isTrue(sourceBelongsToWorker({name: 'desktop · Tailscale'}, 'desktop'))
	assert.isFalse(sourceBelongsToWorker({name: 'desktop · Tailscale'}, 'dev'))
	assert.isFalse(sourceBelongsToWorker({name: 'Docker'}, 'dev'))
})
