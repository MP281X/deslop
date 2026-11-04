import {assert, it} from '@effect/vitest'

import {Effect, pipe} from 'effect'

import {needsSignIn, rejected} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'

it('redirects missing credentials, not authorization outages or denied access', () => {
	assert.isTrue(needsSignIn(AuthError.make({message: 'Sign in first'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'access_denied', message: 'Admins only'})))
	assert.isFalse(needsSignIn({_tag: 'NetworkError', message: 'Connection lost'}))
})

it.effect(
	'keeps an auth failure as it is and wraps anything else',
	Effect.fnUntraced(function* () {
		const signIn = AuthError.make({message: 'Sign in first'})
		assert.strictEqual(yield* Effect.flip(pipe(Effect.fail(signIn), rejected('The app could not be read.'))), signIn)
		const cause = {_tag: 'StorageError', message: 'The store is unreadable.'}
		const error = yield* Effect.flip(pipe(Effect.fail(cause), rejected('The app could not be read.')))
		assert.instanceOf(error, AuthError)
		assert.strictEqual(error.cause, cause)
	})
)
