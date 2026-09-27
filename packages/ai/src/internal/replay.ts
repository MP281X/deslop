import {Array, Chunk, Effect, Option, PubSub, Ref, Semaphore, Stream, String, pipe} from 'effect'

import {Prompt, Response} from 'effect/unstable/ai'

import type {Ai} from '#service'

type Delta = Extract<Ai.Event, {type: 'reasoning-delta' | 'text-delta'}>

type Pending = {deltas: Chunk.Chunk<string>; event: Delta}

type ReplayState = {history: Chunk.Chunk<Ai.Event>; pending: Option.Option<Pending>}

function materialize(pending: Pending) {
	const delta = Chunk.join(pending.deltas, '')
	if (pending.event.type === 'text-delta') {
		return Response.makePart('text-delta', {delta, id: pending.event.id})
	}
	return Response.makePart('reasoning-delta', {delta, id: pending.event.id})
}

function flushed(state: ReplayState) {
	return Option.match(state.pending, {
		onNone: () => state.history,
		onSome: pending => Chunk.append(state.history, materialize(pending))
	})
}

function append(state: ReplayState, event: Ai.Event) {
	if (Prompt.isMessage(event) || (event.type !== 'text-delta' && event.type !== 'reasoning-delta')) {
		return Option.some({history: Chunk.append(flushed(state), event), pending: Option.none()})
	}
	if (String.isEmpty(event.delta)) return Option.none()
	return pipe(
		state.pending,
		Option.filter(pending => pending.event.type === event.type && pending.event.id === event.id),
		Option.match({
			onNone: () =>
				Option.some({history: flushed(state), pending: Option.some({deltas: Chunk.of(event.delta), event})}),
			onSome: pending =>
				Option.some({
					history: state.history,
					pending: Option.some({...pending, deltas: Chunk.append(pending.deltas, event.delta)})
				})
		})
	)
}

export const makeReplay = Effect.fnUntraced(function* (initial: Ai.Event[]) {
	const gate = yield* Semaphore.make(1)
	const pubsub = yield* PubSub.unbounded<Ai.Event>()
	const state = yield* Ref.make(
		Array.reduce(initial, {history: Chunk.empty<Ai.Event>(), pending: Option.none<Pending>()}, (current, event) =>
			Option.getOrElse(append(current, event), () => current)
		)
	)

	const publish = Effect.fnUntraced(function* (event: Ai.Event) {
		yield* Semaphore.withPermit(gate)(
			Effect.gen(function* () {
				yield* Option.match(append(yield* Ref.get(state), event), {
					onNone: () => Effect.void,
					onSome: next => Effect.andThen(Ref.set(state, next), PubSub.publish(pubsub, event))
				})
			})
		)
	})

	const events = Stream.unwrap(
		pipe(
			Effect.gen(function* () {
				const subscription = yield* PubSub.subscribe(pubsub)
				return Stream.concat(Stream.fromIterable(flushed(yield* Ref.get(state))), Stream.fromSubscription(subscription))
			}),
			Semaphore.withPermit(gate)
		)
	)

	yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))

	return {events, publish}
})
