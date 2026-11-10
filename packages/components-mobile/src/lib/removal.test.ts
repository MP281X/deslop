import {assert, it} from '@effect/vitest'

import {Clock, Effect, Layer, Option, Ref, Schema} from 'effect'

import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRegistry} from 'effect/reactivity'
import {TestClock} from 'effect/testing'
// oxlint-disable-next-line no-restricted-imports -- Node cannot load native modules; stub only platform imports, exercising the real removal machine.
import {vi} from 'vite-plus/test'

import {makeRemoval} from '#lib/removal.ts'

vi.mock('@expo/ui/swift-ui/modifiers', () => ({createModifier: () => undefined}))
vi.mock('expo', () => ({requireNativeModule: () => ({})}))
vi.mock('expo-asset', () => ({Asset: {}}))
vi.mock('expo-file-system', () => ({
	File: class {
		readonly name = ''
	},
	Paths: {cache: 'file:///cache'}
}))
vi.mock('react-native', () => ({Alert: {alert: () => {}}}))

class RemovalError extends Schema.TaggedError<RemovalError>()('RemovalError', {message: Schema.String}) {}

function harness(failure = false) {
	return Effect.gen(function* () {
		const calls = yield* Ref.make(0)
		const removal = makeRemoval({
			notRemoved: 'Not Deleted',
			remove: () => {
				if (failure) return Effect.fail(RemovalError.make({message: 'The server refused'}))
				return Ref.update(calls, count => count + 1)
			}
		})
		return {atom: removal('2f1c1f6e-6a39-4a4e-9a2a-0a6e5d7c9b11'), calls}
	})
}

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'removes once when the row is gone and the eight seconds pass',
		Effect.fnUntraced(function* () {
			Atom.runtime.addGlobalLayer(Layer.succeed(Clock.Clock, yield* Clock.Clock))
			const scenario = yield* harness()
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* Atom.mount(AtomMachine.selectSnapshot(scenario.atom, 'Pending'))
					yield* Atom.set(scenario.atom.send, {_tag: 'Removed'})
				})
			)
			yield* TestClock.adjust('8 seconds')
			yield* Effect.yieldNow
			assert.strictEqual(yield* Ref.get(scenario.calls), 1)
			assert.isTrue(Option.isSome(yield* Atom.getResult(AtomMachine.selectSnapshot(scenario.atom, 'Removed'))))
		})
	)

	test.effect(
		'restores before the eight seconds, so the server is never called',
		Effect.fnUntraced(function* () {
			Atom.runtime.addGlobalLayer(Layer.succeed(Clock.Clock, yield* Clock.Clock))
			const scenario = yield* harness()
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* Atom.mount(AtomMachine.selectSnapshot(scenario.atom, 'Pending'))
					yield* Atom.set(scenario.atom.send, {_tag: 'Removed'})
					yield* Atom.set(scenario.atom.send, {_tag: 'Restored'})
				})
			)
			yield* TestClock.adjust('16 seconds')
			yield* Effect.yieldNow
			assert.strictEqual(yield* Ref.get(scenario.calls), 0)
			assert.isTrue(Option.isSome(yield* Atom.getResult(AtomMachine.selectSnapshot(scenario.atom, 'Idle'))))
		})
	)

	test.effect(
		'returns to idle when the server refuses',
		Effect.fnUntraced(function* () {
			Atom.runtime.addGlobalLayer(Layer.succeed(Clock.Clock, yield* Clock.Clock))
			const scenario = yield* harness(true)
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* Atom.mount(AtomMachine.selectSnapshot(scenario.atom, 'Pending'))
					yield* Atom.set(scenario.atom.send, {_tag: 'Removed'})
				})
			)
			yield* TestClock.adjust('8 seconds')
			yield* Effect.yieldNow
			assert.isTrue(Option.isSome(yield* Atom.getResult(AtomMachine.selectSnapshot(scenario.atom, 'Idle'))))
		})
	)
})
