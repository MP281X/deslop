import {assert, it} from '@effect/vitest'

import {PROVIDERS, providerOfKey} from '#routes/(home)/-keys.tsx'

it('takes the provider from a pasted key’s prefix, otherwise the flow’s first', () => {
	assert.strictEqual(providerOfKey('sk-ant-api03-abc'), 'anthropic')
	assert.strictEqual(providerOfKey('sk-or-v1-abc'), 'openrouter')
	assert.strictEqual(providerOfKey('sk-proj-abc'), PROVIDERS[0])
	assert.strictEqual(providerOfKey(''), PROVIDERS[0])
})
