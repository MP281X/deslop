import {assert, it} from '@effect/vitest'

import {formatError} from '#lib/utils.ts'

it('formats JSON errors without letting non-JSON values break the error screen', () => {
	assert.strictEqual(formatError({reason: 'Unavailable'}), '{"reason":"Unavailable"}')
	const circular: {self?: unknown} = {}
	circular.self = circular
	assert.strictEqual(formatError(circular), 'Unknown Error')
	assert.strictEqual(formatError({value: 1n}), 'Unknown Error')
})
