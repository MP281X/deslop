import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

import {runtimeUrl} from './update.ts'

it.effect(
	'asks a wildcard or IPv6 listener on an address a URL can name',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(
			[
				yield* runtimeUrl('127.0.0.1', '5101'),
				yield* runtimeUrl('0.0.0.0', '5101'),
				yield* runtimeUrl('::', '5101'),
				yield* runtimeUrl('::1', '5101'),
				yield* runtimeUrl('localhost', '5101')
			],
			[
				'http://127.0.0.1:5101/api/runtime',
				'http://127.0.0.1:5101/api/runtime',
				'http://[::1]:5101/api/runtime',
				'http://[::1]:5101/api/runtime',
				'http://localhost:5101/api/runtime'
			]
		)
		assert.strictEqual((yield* Effect.flip(runtimeUrl('bad host', '5101')))._tag, 'AppError')
	})
)
