import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {navigationAtom} from '#lib/utils.ts'

const OPERATION = {app: 'deploy', name: 'Inventory.snapshot', runtime: 'server' as const}

const fixture = Effect.gen(function* () {
	const registry = yield* AtomRegistry.AtomRegistry
	yield* Effect.acquireRelease(
		Effect.sync(() => registry.mount(navigationAtom.result)),
		unmount => Effect.sync(unmount)
	)
	return yield* AtomRegistry.getResult(registry, navigationAtom.ref)
})

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'backs out one inspector level at a time without losing the selected operation, trace or span',
		Effect.fnUntraced(function* () {
			const navigation = yield* fixture
			assert.strictEqual((yield* navigation.snapshot).state.state.path, 'Operations')
			yield* navigation.send({_tag: 'Operation', operation: OPERATION})
			assert.strictEqual((yield* navigation.snapshot).state.state.path, 'Traces')
			yield* navigation.send({_tag: 'Trace', selection: {operation: OPERATION, traceId: 'second'}})
			assert.strictEqual((yield* navigation.snapshot).state.state.path, 'Trace')
			yield* navigation.send({_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}})
			assert.strictEqual((yield* navigation.snapshot).state.state.path, 'Span')
			for (const pane of ['Trace', 'Traces', 'Operations']) {
				yield* navigation.send({_tag: 'Back'})
				const snapshot = yield* navigation.snapshot
				assert.strictEqual(snapshot.state.state.path, pane)
				assert.deepStrictEqual(snapshot.state.state.value.selection, {
					operation: OPERATION,
					spanId: 'child',
					traceId: 'second'
				})
			}
			yield* navigation.send({_tag: 'Back'})
			assert.strictEqual((yield* navigation.snapshot).state.state.path, 'Operations')
		})
	)

	test.effect(
		'a new operation or trace cannot inherit the previous span selection',
		Effect.fnUntraced(function* () {
			const navigation = yield* fixture
			yield* navigation.send({_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}})
			yield* navigation.send({_tag: 'Trace', selection: {operation: OPERATION, traceId: 'third'}})
			assert.deepStrictEqual((yield* navigation.snapshot).state.state.value.selection, {
				operation: OPERATION,
				traceId: 'third'
			})
			yield* navigation.send({_tag: 'Operation', operation: {...OPERATION, name: 'Metrics.current'}})
			assert.deepStrictEqual((yield* navigation.snapshot).state.state.value.selection, {
				operation: {...OPERATION, name: 'Metrics.current'}
			})
		})
	)
})
