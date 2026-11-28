import {
	Array,
	Context,
	DateTime,
	Effect,
	FiberMap,
	Layer,
	MutableHashMap,
	MutableHashSet,
	Option,
	Order,
	Queue,
	Semaphore,
	Stream,
	pipe
} from 'effect'
import type {Tracer} from 'effect'

import type {NoteId} from './contract.ts'

type Pending = {readonly createdAt: DateTime.Utc; readonly id: NoteId}

// What a run has read of a video so far, as the save activity shows it.
type Progress = {elapsed: number; title: string; total: number}

// The state that lets organizing runs and the requests that change a note take turns: which notes wait for a worker, which run, which a run could not record, and what a run has made of its note so far.
export class Runs extends Context.Service<Runs>()('@deslop/stash/notes/runs', {
	make: Effect.gen(function* () {
		const running = yield* FiberMap.make<NoteId>()
		// One token per note queued for a worker.
		const ready = yield* Queue.unbounded<void>()
		// A signal only says when to look for organizing notes, so signals sent while a claim runs wait as one.
		const signals = yield* Queue.sliding<void>(1)
		// Claims, starts, stops, removals and a run's writes take turns, so no claim starts a note that is being stopped or deleted.
		const dispatch = yield* Semaphore.make(1)
		// The request each run follows from, kept only to link its trace.
		const requests = MutableHashMap.empty<NoteId, Tracer.Span>()
		// Notes whose last run ended without its outcome stored, because every write failed. No claim starts them again until the person asks again or the server restarts, so a storage failure costs one run per note per server run, which asks until it has one answer, at most twice when the provider answers with an error; kept in memory, not in a table.
		const unrecorded = MutableHashSet.empty<NoteId>()
		// Organizing notes waiting for a worker.
		const queued = MutableHashMap.empty<NoteId, Pending>()
		const progress = MutableHashMap.empty<NoteId, Progress>()
		return {
			// Reads the notes waiting and queues every one this server is neither queuing nor running, in one turn, so repeated signals and scans start each note once.
			claim: <E, R>(read: Effect.Effect<readonly Pending[], E, R>) =>
				Semaphore.withPermit(
					dispatch,
					Effect.flatMap(read, waiting =>
						pipe(
							waiting,
							Array.filter(
								note =>
									!MutableHashMap.has(queued, note.id) &&
									!FiberMap.hasUnsafe(running, note.id) &&
									!MutableHashSet.has(unrecorded, note.id)
							),
							Effect.forEach(
								note =>
									Effect.andThen(
										Effect.sync(() => MutableHashMap.set(queued, note.id, note)),
										Queue.offer(ready, undefined)
									),
								{concurrency: 1, discard: true}
							)
						)
					)
				),
			// Takes the turn of whatever writes while a run could be starting or stopping.
			exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Semaphore.withPermit(dispatch, effect),
			// A removal forgets what the notes' runs kept of it.
			forget: Effect.fn('Runs.forget')((id: NoteId) =>
				Effect.sync(() => {
					MutableHashMap.remove(queued, id)
					MutableHashMap.remove(requests, id)
					MutableHashSet.remove(unrecorded, id)
				})
			),
			isUnrecorded: (id: NoteId) => MutableHashSet.has(unrecorded, id),
			// A commit that leaves a note organizing: the claim looks at once and the run links back to the request.
			requested: Effect.fn('Runs.requested')((id: NoteId, request: Option.Option<Tracer.Span>) =>
				Effect.andThen(
					Effect.sync(() => {
						MutableHashSet.remove(unrecorded, id)
						return Option.map(request, span => MutableHashMap.set(requests, id, span))
					}),
					Queue.offer(signals, undefined)
				)
			),
			signals: Stream.fromQueue(signals),
			// Starts the queued note that was saved last, once a worker is free, so fresh captures jump ahead of the resumed backlog.
			start: <A, E, R>(organize: (id: NoteId) => Effect.Effect<A, E, R>) =>
				Semaphore.withPermit(
					dispatch,
					Effect.suspend(() =>
						Array.match(Array.fromIterable(MutableHashMap.values(queued)), {
							onEmpty: () => Effect.succeedNone,
							onNonEmpty: waiting => {
								const next = Array.max(waiting, Order.Struct({createdAt: DateTime.Order, id: Order.String}))
								MutableHashMap.remove(queued, next.id)
								return Effect.asSome(FiberMap.run(running, next.id, organize(next.id)))
							}
						})
					)
				),
			stop: (id: NoteId) => FiberMap.remove(running, id),
			takeRequest: Effect.fn('Runs.takeRequest')((id: NoteId) =>
				Effect.sync(() => {
					const request = MutableHashMap.get(requests, id)
					MutableHashMap.remove(requests, id)
					return request
				})
			),
			track: Effect.fn('Runs.track')((id: NoteId, update: Progress) =>
				Effect.sync(() => MutableHashMap.set(progress, id, update))
			),
			trackedOf: (id: NoteId) => MutableHashMap.get(progress, id),
			// The run ended without recording its outcome.
			unrecord: Effect.fn('Runs.unrecord')((id: NoteId) => Effect.sync(() => MutableHashSet.add(unrecorded, id))),
			untrack: Effect.fn('Runs.untrack')((id: NoteId) => Effect.sync(() => MutableHashMap.remove(progress, id))),
			// A worker waits here for a queued note.
			waiting: Queue.take(ready)
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
