import {assert, it} from '@effect/vitest'

import {Cause, DateTime, Effect, Option} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {problemSinceAtom, staleSinceAtom} from '#components/problem.tsx'

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'keeps a readerAtom problem age across pane remounts and retry failures, then clears it on recovery',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const sourceAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const problem = problemSinceAtom(sourceAtom)
			const unmountPage = registry.mount(problem)
			assert.isTrue(Option.isNone(registry.get(problem)))
			registry.set(
				sourceAtom,
				AsyncResult.failureWithPrevious(Cause.fail('firstAtom'), {previous: Option.some(registry.get(sourceAtom))})
			)
			const since = registry.get(problem)
			assert.isTrue(Option.isSome(since))
			registry.mount(problem)()
			registry.set(sourceAtom, AsyncResult.waiting(registry.get(sourceAtom)))
			assert.deepStrictEqual(registry.get(problem), since)
			registry.set(
				sourceAtom,
				AsyncResult.failureWithPrevious(Cause.fail('retry'), {previous: Option.some(registry.get(sourceAtom))})
			)
			assert.deepStrictEqual(registry.get(problem), since)
			const remountPane = registry.mount(problem)
			assert.deepStrictEqual(registry.get(problem), since)
			registry.set(sourceAtom, AsyncResult.success(2))
			assert.isTrue(Option.isNone(registry.get(problem)))
			remountPane()
			unmountPage()
		})
	)

	test.effect(
		'isolates ages by readerAtom and registry without retaining the sourceAtom after the page closes',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const other = yield* Effect.acquireRelease(
				Effect.sync(() => AtomRegistry.make()),
				value => Effect.sync(() => value.dispose())
			)
			const sourceAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const unrelatedAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(2))
			const problem = problemSinceAtom(sourceAtom)
			const unmount = registry.mount(problem)
			registry.set(sourceAtom, AsyncResult.fail('failure'))
			assert.isTrue(Option.isSome(registry.get(problem)))
			assert.isTrue(Option.isNone(other.get(problem)))
			assert.isTrue(Option.isNone(registry.get(problemSinceAtom(unrelatedAtom))))
			unmount()
			yield* Effect.yieldNow
			assert.isFalse(registry.getNodes().has(problem))
		})
	)

	test.effect(
		'counts a readerAtom only while its failure still carries its previous value',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const readerAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const aggregate = staleSinceAtom([readerAtom])
			const unmount = registry.mount(aggregate)
			registry.set(readerAtom, AsyncResult.fail('failure'))
			assert.isTrue(Option.isNone(registry.get(aggregate)))
			registry.set(
				readerAtom,
				AsyncResult.failureWithPrevious(Cause.fail('failure'), {previous: Option.some(AsyncResult.success(1))})
			)
			assert.isTrue(Option.isSome(registry.get(aggregate)))
			unmount()
		})
	)

	test.effect(
		'ages the one mark from the oldest readerAtom that is still stale',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const firstAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(1))
			const secondAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(AsyncResult.success(2))
			registry.ensureNode(problemSinceAtom(firstAtom)).setInitialValue(Option.some(DateTime.makeUnsafe(1000)))
			registry.ensureNode(problemSinceAtom(secondAtom)).setInitialValue(Option.some(DateTime.makeUnsafe(2000)))
			const aggregate = staleSinceAtom([firstAtom, secondAtom])
			const unmount = registry.mount(aggregate)
			registry.set(
				firstAtom,
				AsyncResult.failureWithPrevious(Cause.fail('firstAtom'), {previous: Option.some(AsyncResult.success(1))})
			)
			registry.set(
				secondAtom,
				AsyncResult.failureWithPrevious(Cause.fail('secondAtom'), {previous: Option.some(AsyncResult.success(2))})
			)
			assert.strictEqual(DateTime.toEpochMillis(Option.getOrThrow(registry.get(aggregate))), 1000)
			unmount()
		})
	)

	test.effect(
		'refreshes every readerAtom through the one retry',
		Effect.fnUntraced(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const reads = {firstAtom: 0, secondAtom: 0}
			const firstAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(() => {
				reads.firstAtom += 1
				return AsyncResult.success(1)
			})
			const secondAtom = Atom.make<AsyncResult.AsyncResult<number, string>>(() => {
				reads.secondAtom += 1
				return AsyncResult.success(2)
			})
			const aggregate = staleSinceAtom([firstAtom, secondAtom])
			const unmount = registry.mount(aggregate)
			registry.get(aggregate)
			reads.firstAtom = 0
			reads.secondAtom = 0
			registry.refresh(aggregate)
			registry.get(aggregate)
			assert.isAtLeast(reads.firstAtom, 1)
			assert.isAtLeast(reads.secondAtom, 1)
			unmount()
		})
	)
})
