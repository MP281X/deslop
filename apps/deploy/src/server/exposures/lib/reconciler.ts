import type {Equivalence} from 'effect'
import {Deferred, Duration, Effect, Exit, Function, Number, Option, Queue, Ref, pipe} from 'effect'

// One pass at a time over saved state: every request made during a pass shares exactly one more, and an unfinished pass runs again after a pause that doubles from five seconds to ten minutes while it leaves the same things unfinished; a different outcome starts again at five seconds.
export const makeReconciler = Effect.fnUntraced(function* <A, E>(
	pass: Effect.Effect<A, E>,
	finished: (outcome: A) => boolean,
	unchanged: Equivalence.Equivalence<A>
) {
	const wake = yield* Queue.sliding<void>(1)
	const waiting = yield* Ref.make(Option.none<Deferred.Deferred<A, E>>())
	const retry = yield* Ref.make(Option.none<{readonly failed: number; readonly outcome: Option.Option<A>}>())
	yield* pipe(
		Effect.gen(function* () {
			yield* Option.match(yield* Ref.get(retry), {
				onNone: () => Queue.take(wake),
				onSome: state =>
					Effect.raceFirst(
						Queue.take(wake),
						Effect.sleep(
							pipe(Duration.seconds(5), Duration.times(2 ** state.failed), Duration.min(Duration.minutes(10)))
						)
					)
			})
			const served = yield* Ref.getAndSet(waiting, Option.none())
			const exit = yield* Effect.exit(pass)
			yield* Effect.forEach(Option.toArray(served), deferred => Deferred.done(deferred, exit), {
				concurrency: 1,
				discard: true
			})
			yield* Ref.update(retry, state => {
				if (Exit.isSuccess(exit) && finished(exit.value)) return Option.none()
				const before = Option.flatMap(state, last => last.outcome)
				const outcome = Exit.match(exit, {onFailure: () => before, onSuccess: Option.some})
				// A failed pass and one that left the same things unfinished wait longer; anything new is tried again soon.
				return Option.some({
					failed: pipe(
						state,
						Option.filter(() => Option.makeEquivalence(unchanged)(before, outcome)),
						Option.match({onNone: Function.constant(0), onSome: last => Number.min(last.failed + 1, 7)})
					),
					outcome
				})
			})
		}),
		Effect.forever,
		Effect.forkScoped
	)
	return {
		// Asks for a pass and answers with the first one that starts after the request.
		request: Effect.gen(function* () {
			const fresh = yield* Deferred.make<A, E>()
			const deferred = yield* Ref.modify(waiting, current =>
				Option.match(current, {
					onNone: () => [fresh, Option.some(fresh)] as const,
					onSome: pending => [pending, current] as const
				})
			)
			yield* Queue.offer(wake, undefined)
			return yield* Deferred.await(deferred)
		})
	}
})
