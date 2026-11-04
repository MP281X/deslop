import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, Exit, pipe} from 'effect'

import {adminIds, isAdmin, needsSignIn, rejected} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'

function adminsWith(env: Record<string, string>) {
	return pipe(adminIds, Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)))
}

it('redirects missing credentials, not authorization outages or denied access', () => {
	assert.isTrue(needsSignIn(AuthError.make({message: 'Sign in first'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'access_denied', message: 'Admins only'})))
	assert.isFalse(needsSignIn({_tag: 'NetworkError', message: 'Connection lost'}))
})

it.effect(
	'names the local developer as admin unless GITHUB_ADMINS says otherwise',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(yield* adminsWith({}), ['0'])
		assert.deepStrictEqual(yield* adminsWith({GITHUB_ADMINS: '7,9'}), ['7', '9'])
		assert.isTrue(Exit.isFailure(yield* Effect.exit(adminsWith({AUTH_URL: 'https://auth.example'}))))
	})
)

it('reads a user’s admin standing from their bare GitHub id', () => {
	assert.isTrue(isAdmin(['7', '9'], 'github:9'))
	assert.isFalse(isAdmin(['7', '9'], 'github:0'))
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
