import {assert, it} from '@effect/vitest'

import {Array, Effect, Ref, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomRegistry} from 'effect/reactivity'
import {TestClock} from 'effect/testing'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {removalMachine, UndoButton} from '#components/undo.tsx'

// The changes stream starts with the machine's current state, so a transition already applied is found at once.
function settle<E, R>(
	ref: {readonly changes: Stream.Stream<{readonly state: {readonly state: {readonly path: string}}}, E, R>},
	path: string
) {
	return pipe(
		ref.changes,
		Stream.filter(snapshot => snapshot.state.state.path === path),
		Stream.take(1),
		Stream.runHead
	)
}

it.layer(AtomRegistry.layer)(test => {
	test.effect(
		'commits a removal only after its eight seconds',
		Effect.fnUntraced(function* () {
			const committed = yield* Ref.make(Array.empty<string>())
			const removal = removalMachine((id: string) => Ref.update(committed, Array.append(id)))
			const ref = yield* Machine.start(removal)

			yield* ref.send(removal.events.Removed({id: 'first'}))
			yield* settle(ref, 'Waiting')
			assert.deepStrictEqual(yield* Ref.get(committed), [])

			yield* TestClock.adjust('8 seconds')
			yield* settle(ref, 'Idle')
			assert.deepStrictEqual(yield* Ref.get(committed), ['first'])
		})
	)

	test.effect(
		'never commits a removal taken back within its eight seconds',
		Effect.fnUntraced(function* () {
			const committed = yield* Ref.make(Array.empty<string>())
			const removal = removalMachine((id: string) => Ref.update(committed, Array.append(id)))
			const ref = yield* Machine.start(removal)

			yield* ref.send(removal.events.Removed({id: 'first'}))
			yield* TestClock.adjust('7 seconds')
			yield* ref.send(removal.events.Undone())
			yield* settle(ref, 'Idle')

			yield* TestClock.adjust('8 seconds')
			assert.deepStrictEqual(yield* Ref.get(committed), [])
			assert.strictEqual((yield* ref.state).state.path, 'Idle')
		})
	)

	test.effect(
		'commits an earlier removal at once when another row is removed',
		Effect.fnUntraced(function* () {
			const committed = yield* Ref.make(Array.empty<string>())
			const removal = removalMachine((id: string) => Ref.update(committed, Array.append(id)))
			const ref = yield* Machine.start(removal)

			yield* ref.send(removal.events.Removed({id: 'first'}))
			yield* TestClock.adjust('4 seconds')
			yield* ref.send(removal.events.Removed({id: 'second'}))

			yield* settle(ref, 'Waiting')
			assert.deepStrictEqual(yield* Ref.get(committed), ['first'])
			assert.deepStrictEqual((yield* ref.state).state.value, {_tag: 'Waiting', id: 'second'})

			yield* TestClock.adjust('7 seconds')
			assert.deepStrictEqual(yield* Ref.get(committed), ['first'])

			yield* TestClock.adjust('1 second')
			yield* settle(ref, 'Idle')
			assert.deepStrictEqual(yield* Ref.get(committed), ['first', 'second'])
		})
	)

	test.effect(
		'keeps a failed commit on its row with the reason',
		Effect.fnUntraced(function* () {
			const failure = {message: 'The row could not be removed.'}
			const removal = removalMachine(() => Effect.fail(failure))
			const ref = yield* Machine.start(removal)

			yield* ref.send(removal.events.Removed({id: 'first'}))
			yield* TestClock.adjust('8 seconds')
			yield* settle(ref, 'Failed')

			const failed = (yield* ref.state).state
			assert.strictEqual(failed.path, 'Failed')
			assert.deepStrictEqual(failed.value, {_tag: 'Failed', id: 'first', message: failure.message})

			yield* ref.send(removal.events.Dismissed())
			yield* settle(ref, 'Idle')
		})
	)
})

it('offers Undo as the row action that takes a waiting removal back', () => {
	const html = renderToStaticMarkup(createElement(UndoButton))
	assert.match(html, /<button[^>]*>.*Undo<\/button>/u)
	assert.include(html, '<svg')
})
