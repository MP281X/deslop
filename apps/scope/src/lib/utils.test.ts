import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {navigationAtom} from '#lib/utils.ts'
import type {NavigationEvent} from '#lib/utils.ts'

const OPERATION = {app: 'deploy', name: 'Inventory.snapshot', runtime: 'server' as const}

const fixture = Effect.gen(function* () {
	const registry = yield* AtomRegistry.AtomRegistry
	yield* Effect.acquireRelease(
		Effect.sync(() => registry.mount(navigationAtom)),
		unmount => Effect.sync(unmount)
	)
	return {
		read: () => registry.get(navigationAtom),
		send: (event: NavigationEvent) => registry.set(navigationAtom, event)
	}
})

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'backs out one inspector level at a time without losing the selected operation, trace or span',
		Effect.fnUntraced(function* () {
			const navigation = yield* fixture
			assert.strictEqual(navigation.read().path, 'Operations')
			navigation.send({_tag: 'Operation', operation: OPERATION})
			assert.strictEqual(navigation.read().path, 'Traces')
			navigation.send({_tag: 'Trace', selection: {operation: OPERATION, traceId: 'second'}})
			assert.strictEqual(navigation.read().path, 'Trace')
			navigation.send({_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}})
			assert.strictEqual(navigation.read().path, 'Span')
			for (const pane of ['Trace', 'Traces', 'Operations']) {
				navigation.send({_tag: 'Back'})
				assert.strictEqual(navigation.read().path, pane)
				assert.deepStrictEqual(navigation.read().selection, {operation: OPERATION, spanId: 'child', traceId: 'second'})
			}
			navigation.send({_tag: 'Back'})
			assert.strictEqual(navigation.read().path, 'Operations')
		})
	)

	test.effect(
		'a new operation or trace cannot inherit the previous span selection',
		Effect.fnUntraced(function* () {
			const navigation = yield* fixture
			navigation.send({_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}})
			navigation.send({_tag: 'Trace', selection: {operation: OPERATION, traceId: 'third'}})
			assert.deepStrictEqual(navigation.read().selection, {operation: OPERATION, traceId: 'third'})
			navigation.send({_tag: 'Operation', operation: {...OPERATION, name: 'Metrics.current'}})
			assert.deepStrictEqual(navigation.read().selection, {operation: {...OPERATION, name: 'Metrics.current'}})
		})
	)
})
