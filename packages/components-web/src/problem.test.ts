import {assert, it} from '@effect/vitest'

import {Cause, Effect, Option} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {problemSinceAtom, staleSinceAtom} from '#components/problem.tsx'

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

	test.effect(
		'counts a reader only while its failure still carries its previous value',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const reader = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const aggregate = staleSinceAtom([reader])
			const unmount = registry.mount(aggregate)
			registry.set(reader, AsyncResult.fail('failure'))
			assert.isTrue(Option.isNone(registry.get(aggregate)))
			registry.set(
				reader,
				AsyncResult.failureWithPrevious(Cause.fail('failure'), {previous: Option.some(AsyncResult.success(1))})
			)
			assert.isTrue(Option.isSome(registry.get(aggregate)))
			unmount()
		})
	)

	test.effect(
		'ages the one mark from the oldest reader that is still stale',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const first = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const second = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(2))
			registry.ensureNode(problemSinceAtom(first)).setInitialValue(Option.some(1000))
			registry.ensureNode(problemSinceAtom(second)).setInitialValue(Option.some(2000))
			const aggregate = staleSinceAtom([first, second])
			const unmount = registry.mount(aggregate)
			registry.set(
				first,
				AsyncResult.failureWithPrevious(Cause.fail('first'), {previous: Option.some(AsyncResult.success(1))})
			)
			registry.set(
				second,
				AsyncResult.failureWithPrevious(Cause.fail('second'), {previous: Option.some(AsyncResult.success(2))})
			)
			assert.strictEqual(Option.getOrThrow(registry.get(aggregate)), 1000)
			unmount()
		})
	)

	test.effect(
		'refreshes every reader through the one retry',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const reads = {first: 0, second: 0}
			const first = Atom.make<AsyncResult.AsyncResult<number, string>>(() => {
				reads.first += 1
				return AsyncResult.success(1)
			})
			const second = Atom.make<AsyncResult.AsyncResult<number, string>>(() => {
				reads.second += 1
				return AsyncResult.success(2)
			})
			const aggregate = staleSinceAtom([first, second])
			const unmount = registry.mount(aggregate)
			registry.get(aggregate)
			reads.first = 0
			reads.second = 0
			registry.refresh(aggregate)
			registry.get(aggregate)
			assert.isAtLeast(reads.first, 1)
			assert.isAtLeast(reads.second, 1)
			unmount()
		})
	)
})
