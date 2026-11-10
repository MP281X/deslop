import {assert, it} from '@effect/vitest'

import {Array, Cause, Schema} from 'effect'

import {AuthError} from '#auth/schema.ts'

function namesOf(error: AuthError) {
	return Array.map(Cause.prettyErrors(Cause.fail(error)), rendered => rendered.name)
}

it('names an authorization outage apart from a refusal', () => {
	const outage = AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})
	assert.deepStrictEqual(namesOf(AuthError.make({message: 'Sign in first'})), ['AuthError'])
	assert.deepStrictEqual(namesOf(outage), ['AuthUnavailable'])
	assert.strictEqual(outage._tag, 'AuthError')
	assert.isTrue(Schema.is(AuthError)(outage))
})
