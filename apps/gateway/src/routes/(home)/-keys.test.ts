import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

// The key page reads the browser's origin when its module loads.
it.effect(
	'takes the provider from a pasted key’s prefix, otherwise the flow’s first',
	Effect.fnUntraced(function* () {
		/* oxlint-disable no-restricted-globals, no-restricted-properties -- The key page's atoms read the browser's origin at module load. */
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Object.defineProperty(globalThis, 'window', {
					configurable: true,
					value: {location: {origin: 'https://gateway.mp281x.xyz'}}
				})
			),
			() =>
				Effect.sync(() => {
					if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
					else Object.defineProperty(globalThis, 'window', previous)
				})
		)
		/* oxlint-enable no-restricted-globals, no-restricted-properties */
		const keys = yield* Effect.promise(() => import('#routes/(home)/-keys.tsx'))
		assert.strictEqual(keys.providerOfKey('sk-ant-api03-abc'), 'anthropic')
		assert.strictEqual(keys.providerOfKey('sk-or-v1-abc'), 'openrouter')
		assert.strictEqual(keys.providerOfKey('sk-proj-abc'), keys.PROVIDERS[0])
		assert.strictEqual(keys.providerOfKey(''), keys.PROVIDERS[0])
	})
)
