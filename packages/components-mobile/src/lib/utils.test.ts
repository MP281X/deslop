import {assert, it} from '@effect/vitest'

import {Array, Effect, Fiber, Option, Queue, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {File} from 'expo-file-system'
// oxlint-disable-next-line no-restricted-imports -- Node cannot load native modules; stub only platform imports, exercising the real cache and atom runtime.
import {vi} from 'vite-plus/test'

import {cachedList} from '#lib/utils.ts'

vi.mock('@expo/ui/swift-ui/modifiers', () => ({createModifier: () => undefined}))
vi.mock('expo', () => ({requireNativeModule: () => undefined}))
vi.mock('expo-asset', () => ({Asset: {}}))
vi.mock('react-native', () => ({Alert: {}}))
vi.mock('expo-file-system', () => ({
	File: class {
		name = 'list.json'
		uri = 'file:///list.json'
		text = '[{"id":"old"}]'
		textSync() {
			return this.text
		}
		writeSync(text: string) {
			this.text = text
		}
		moveSync(file: {writeSync: (text: string) => void}) {
			file.writeSync(this.text)
		}
	}
}))

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'keeps a loaded empty list across an offline resume before it has reached disk',
		Effect.fnUntraced(function* () {
			const source = yield* Queue.unbounded<{id: string}[]>()
			const opened = yield* Queue.unbounded<void>()
			const resumed = Atom.make(0)
			const file = new File('file:///list.json')
			const list = Atom.make(get => {
				get(resumed)
				return cachedList(
					get,
					file,
					Schema.Struct({id: Schema.String}),
					Stream.concat(Stream.drain(Stream.fromEffect(Queue.offer(opened, undefined))), Stream.fromQueue(source))
				)
			})
			yield* Atom.mount(list)
			assert.deepStrictEqual(yield* Atom.getResult(list), [{id: 'old'}])
			yield* Queue.take(opened)
			const cleared = yield* Effect.forkChild(
				pipe(
					AtomRegistry.toStream(yield* AtomRegistry.AtomRegistry, list),
					Stream.filter(result => AsyncResult.isSuccess(result) && Array.isReadonlyArrayEmpty(result.value)),
					Stream.runHead
				)
			)
			yield* Queue.offer(source, [])
			yield* Fiber.join(cleared)
			yield* Atom.set(resumed, 1)
			yield* Queue.take(opened)
			assert.deepStrictEqual(yield* Atom.getResult(list), [])
			assert.strictEqual(file.textSync(), '[{"id":"old"}]')
		}, Effect.scoped)
	)

	test.effect(
		'waits for sign-in without treating it as an authoritative empty list',
		Effect.fnUntraced(function* () {
			const signedIn = Atom.make(false)
			const file = new File('file:///list.json')
			const list = Atom.make(get => {
				if (!get(signedIn)) return Stream.never
				return cachedList(get, file, Schema.Struct({id: Schema.String}), Stream.never)
			})
			yield* Atom.mount(list)
			assert.isTrue(AsyncResult.isInitial(yield* Atom.get(list)))
			yield* Atom.set(signedIn, true)
			assert.deepStrictEqual(yield* Atom.getResult(list), [{id: 'old'}])
		}, Effect.scoped)
	)

	test.effect(
		'hydrates a saved empty list before the first server response',
		Effect.fnUntraced(function* () {
			const file = new File('file:///list.json')
			file.writeSync('[]')
			const opened = yield* Queue.unbounded<void>()
			const list = Atom.make(get =>
				cachedList(
					get,
					file,
					Schema.Struct({id: Schema.String}),
					Stream.concat(Stream.drain(Stream.fromEffect(Queue.offer(opened, undefined))), Stream.never)
				)
			)
			yield* Atom.mount(list)
			yield* Queue.take(opened)
			assert.deepStrictEqual(AsyncResult.value(yield* Atom.get(list)), Option.some([]))
		}, Effect.scoped)
	)
})
