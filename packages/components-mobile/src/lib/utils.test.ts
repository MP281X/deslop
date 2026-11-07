import {assert, it} from '@effect/vitest'

import {Array, Effect, Fiber, Function, Option, Queue, Ref, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {TestClock} from 'effect/testing'
import {File} from 'expo-file-system'
// oxlint-disable-next-line no-restricted-imports -- Node cannot load native modules; stub only platform imports, exercising the real cache and atom runtime.
import {vi} from 'vite-plus/test'

import {AuthError} from '@deslop/runtime/auth/schema'

import {readClipboard} from '#lib/clipboard.ts'
import {cachedList} from '#lib/utils.ts'

const clipboard = vi.hoisted(() => ({count: 1}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({createModifier: () => undefined}))
vi.mock('expo', () => ({requireNativeModule: () => ({clipboardChangeCount: () => clipboard.count})}))
vi.mock('expo-asset', () => ({Asset: {}}))
vi.mock('react-native', () => ({Alert: {}}))
vi.mock('expo-file-system', () => ({
	File: class {
		name = 'list.json'
		uri = 'file:///list.json'
		text = '[{"id":"old"}]'
		exists = true
		textSync() {
			if (!this.exists) throw new TypeError('File not found')
			return this.text
		}
		writeSync(text: string) {
			this.exists = true
			this.text = text
		}
		delete() {
			this.exists = false
		}
		moveSync(file: {writeSync: (text: string) => void}) {
			file.writeSync(this.text)
		}
	}
}))

it.layer(AtomRegistry.layer)(test => {
	test.effect.each([
		{
			error: AuthError.make({error: 'access_denied', message: 'Denied'}),
			kept: false,
			name: 'cancels a pending cache write after denial',
			saved: false
		},
		{
			error: AuthError.make({error: 'access_denied', message: 'Denied'}),
			kept: false,
			name: 'removes the saved cache after denial',
			saved: true
		},
		{
			error: AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}),
			kept: true,
			name: 'keeps the cache during a temporary auth outage',
			saved: false
		},
		{error: 'Offline', kept: true, name: 'keeps the cache during an ordinary outage', saved: false}
	])('$name', scenario =>
		Effect.scoped(
			Effect.gen(function* () {
				const file = new File('file:///list.json')
				const incoming = yield* Queue.unbounded<Effect.Effect<{id: string}[], AuthError | string>>()
				const list = Atom.make(get =>
					cachedList(
						get,
						file,
						Schema.Struct({id: Schema.String}),
						pipe(Stream.fromQueue(incoming), Stream.mapEffect(Function.identity))
					)
				)
				const registry = yield* AtomRegistry.AtomRegistry
				yield* Atom.mount(list)
				assert.deepStrictEqual(yield* Atom.getResult(list), [{id: 'old'}])
				const updated = yield* Effect.forkChild(
					pipe(
						AtomRegistry.toStream(registry, list),
						Stream.filter(result => Option.exists(AsyncResult.value(result), items => items[0]?.id === 'fresh')),
						Stream.runHead
					)
				)
				yield* Queue.offer(incoming, Effect.succeed([{id: 'fresh'}]))
				yield* Fiber.join(updated)
				if (scenario.saved) yield* TestClock.adjust('3 seconds')
				const failed = yield* Effect.forkChild(
					pipe(AtomRegistry.toStream(registry, list), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				)
				yield* Queue.offer(incoming, Effect.fail(scenario.error))
				yield* Fiber.join(failed)
				yield* TestClock.adjust('3 seconds')
				assert.strictEqual(file.exists, scenario.kept)
				const cold = yield* Effect.acquireRelease(
					Effect.sync(() => AtomRegistry.make()),
					value => Effect.sync(() => value.dispose())
				)
				const opened = yield* Queue.unbounded<void>()
				const restarted = Atom.make(get =>
					cachedList(
						get,
						file,
						Schema.Struct({id: Schema.String}),
						Stream.concat(Stream.drain(Stream.fromEffect(Queue.offer(opened, undefined))), Stream.never)
					)
				)
				cold.mount(restarted)
				yield* Queue.take(opened)
				assert.strictEqual(Option.isSome(AsyncResult.value(cold.get(restarted))), scenario.kept)
			})
		)
	)

	test.effect(
		'reads an offered copy once when its metadata stays current',
		Effect.fnUntraced(function* () {
			clipboard.count = 1
			const reads = yield* Ref.make(0)
			assert.strictEqual(
				yield* readClipboard(
					'1',
					Effect.as(
						Ref.update(reads, count => count + 1),
						'copy'
					)
				),
				'copy'
			)
			assert.strictEqual(yield* Ref.get(reads), 1)
		})
	)

	test.effect(
		'refuses a changed clipboard before reading its contents',
		Effect.fnUntraced(function* () {
			clipboard.count = 2
			const reads = yield* Ref.make(0)
			const error = yield* Effect.flip(
				readClipboard(
					'1',
					Ref.update(reads, count => count + 1)
				)
			)
			assert.strictEqual(error._tag, 'ClipboardError')
			assert.strictEqual(yield* Ref.get(reads), 0)
		})
	)

	test.effect(
		'rejects a copy changed during the asynchronous native read',
		Effect.fnUntraced(function* () {
			clipboard.count = 1
			const entered = yield* Queue.unbounded<void>()
			const answer = yield* Queue.unbounded<string>()
			const reading = yield* Effect.forkChild(
				readClipboard('1', Effect.andThen(Queue.offer(entered, undefined), Queue.take(answer)))
			)
			yield* Queue.take(entered)
			clipboard.count = 2
			yield* Queue.offer(answer, 'different copy')
			assert.strictEqual((yield* Effect.flip(Fiber.join(reading)))._tag, 'ClipboardError')
		})
	)

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
