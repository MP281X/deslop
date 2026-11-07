import {assert, it} from '@effect/vitest'

import {Cause, Effect, Option} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {problemSinceAtom} from '#components/problem.tsx'

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'keeps a reader problem age across pane remounts and retry failures, then clears it on recovery',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const source = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const problem = problemSinceAtom(source)
			const unmountPage = registry.mount(problem)
			assert.isTrue(Option.isNone(registry.get(problem)))
			registry.set(
				source,
				AsyncResult.failureWithPrevious(Cause.fail('first'), {previous: Option.some(registry.get(source))})
			)
			const since = registry.get(problem)
			assert.isTrue(Option.isSome(since))
			registry.mount(problem)()
			registry.set(source, AsyncResult.waiting(registry.get(source)))
			assert.deepStrictEqual(registry.get(problem), since)
			registry.set(
				source,
				AsyncResult.failureWithPrevious(Cause.fail('retry'), {previous: Option.some(registry.get(source))})
			)
			assert.deepStrictEqual(registry.get(problem), since)
			const remountPane = registry.mount(problem)
			assert.deepStrictEqual(registry.get(problem), since)
			registry.set(source, AsyncResult.success(2))
			assert.isTrue(Option.isNone(registry.get(problem)))
			remountPane()
			unmountPage()
		})
	)

	test.effect(
		'isolates ages by reader and registry without retaining the source after the page closes',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const other = yield* Effect.acquireRelease(
				Effect.sync(() => AtomRegistry.make()),
				value => Effect.sync(() => value.dispose())
			)
			const source = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const unrelated = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(2))
			const problem = problemSinceAtom(source)
			const unmount = registry.mount(problem)
			registry.set(source, AsyncResult.fail('failure'))
			assert.isTrue(Option.isSome(registry.get(problem)))
			assert.isTrue(Option.isNone(other.get(problem)))
			assert.isTrue(Option.isNone(registry.get(problemSinceAtom(unrelated))))
			unmount()
			yield* Effect.yieldNow
			assert.isFalse(registry.getNodes().has(problem))
		})
	)
})
