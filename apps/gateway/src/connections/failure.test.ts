import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {AuthError} from '@deslop/runtime/shared/auth'

import {FailureReason, UpstreamError, UpstreamExchangeError} from './contract.ts'
import {connectionFailure, describe} from './failure.ts'

it('reads a failure by its fixed reason, however deep its cause lies', () => {
	const timeout = UpstreamExchangeError.make({
		expired: false,
		reason: FailureReason.cases.Timeout.make({}),
		unauthorized: false
	})
	assert.deepStrictEqual(describe(timeout), FailureReason.cases.Timeout.make({}))
	assert.deepStrictEqual(
		describe(UpstreamError.make({cause: UpstreamError.make({cause: {code: 'ECONNREFUSED'}})})),
		FailureReason.cases.Refused.make({})
	)
	assert.deepStrictEqual(
		describe(AuthError.make({error: 'temporarily_unavailable', message: 'down'})),
		FailureReason.cases.Unavailable.make({})
	)
	assert.deepStrictEqual(describe({code: 'EOTHER'}), FailureReason.cases.Unknown.make({}))
})

it('gives up on a cause chain deeper than it follows', () => {
	assert.deepStrictEqual(
		describe(
			Array.reduce<number, unknown>(Array.range(1, 10), {code: 'ECONNREFUSED'}, cause => UpstreamError.make({cause}))
		),
		FailureReason.cases.Unknown.make({})
	)
})

it('keeps an error code a failure carries and marks any other as unavailable', () => {
	const kept = connectionFailure('Cannot connect this MCP')(
		AuthError.make({error: 'access_denied', message: 'secret-token-in-body'})
	)
	assert.strictEqual(kept.error, 'access_denied')
	assert.strictEqual(
		connectionFailure('Cannot add')(UpstreamError.make({cause: 'boom'})).error,
		'temporarily_unavailable'
	)
})
