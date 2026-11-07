import {assert, it} from '@effect/vitest'

import {Cause, ConfigProvider, Effect, Exit, Option, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {adminIds, isAdmin, needsSignIn, rejected, withoutDeniedData} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'

function adminsWith(env: Record<string, string>) {
	return pipe(adminIds, Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)))
}

it('does not resurrect denied data after another failure, and accepts a fresh success', () => {
	const initial = AsyncResult.success('private')
	const source = Atom.keepAlive(Atom.make<AsyncResult.AsyncResult<string, AuthError | string>>(initial))
	const protectedData = withoutDeniedData(source)
	const registry = AtomRegistry.make()
	try {
		const dispose = registry.mount(protectedData)
		assert.deepStrictEqual(AsyncResult.value(registry.get(protectedData)), Option.some('private'))
		const denied = AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Denied'}), {
			previous: Option.some(initial)
		})
		registry.set(source, denied)
		registry.set(source, AsyncResult.waiting(denied))
		registry.set(
			source,
			AsyncResult.failWithPrevious<string, AuthError | string>('Retry failed', {previous: Option.some(denied)})
		)
		assert.deepStrictEqual(AsyncResult.value(registry.get(protectedData)), Option.none())
		dispose()
		const rejoin = registry.mount(protectedData)
		assert.deepStrictEqual(AsyncResult.value(registry.get(protectedData)), Option.none())
		const fresh = AsyncResult.success('fresh')
		registry.set(source, fresh)
		registry.set(source, AsyncResult.failWithPrevious('Later outage', {previous: Option.some(fresh)}))
		assert.deepStrictEqual(AsyncResult.value(registry.get(protectedData)), Option.some('fresh'))
		rejoin()
	} finally {
		registry.dispose()
	}
})

it('keeps authorization invalidation local to its registry', () => {
	const initial = AsyncResult.success('private')
	const source = Atom.make<AsyncResult.AsyncResult<string, AuthError>>(initial)
	const protectedData = withoutDeniedData(source)
	const first = AtomRegistry.make()
	const second = AtomRegistry.make()
	try {
		first.mount(protectedData)
		second.mount(protectedData)
		const denied = AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Denied'}), {
			previous: Option.some(initial)
		})
		first.set(source, denied)
		assert.strictEqual(first.get(source), denied)
		second.set(source, AsyncResult.failure(Cause.die('Offline'), {previousSuccess: Option.some(initial)}))
		assert.deepStrictEqual(AsyncResult.value(first.get(protectedData)), Option.none())
		assert.deepStrictEqual(AsyncResult.value(second.get(protectedData)), Option.some('private'))
	} finally {
		first.dispose()
		second.dispose()
	}
})

it('invalidates retained data with any authorization failure in a combined cause', () => {
	const denied = Cause.makeFailReason(AuthError.make({error: 'access_denied', message: 'Denied'}))
	const offline = Cause.makeFailReason('Offline')
	for (const reasons of [
		[denied, offline],
		[offline, denied]
	]) {
		const initial = AsyncResult.success('private')
		const source = Atom.make<AsyncResult.AsyncResult<string, AuthError | string>>(initial)
		const protectedData = withoutDeniedData(source)
		const registry = AtomRegistry.make()
		try {
			registry.mount(protectedData)
			registry.set(
				source,
				AsyncResult.failure(Cause.fromReasons<AuthError | string>(reasons), {previousSuccess: Option.some(initial)})
			)
			assert.deepStrictEqual(AsyncResult.value(registry.get(protectedData)), Option.none())
		} finally {
			registry.dispose()
		}
	}
})

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
