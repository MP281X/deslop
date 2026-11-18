import {Deferred, Duration, Effect, Exit, Function, Number, Option, Queue, Ref, pipe} from 'effect'

// One pass at a time over saved state: every request made during a pass shares exactly one more, and an unfinished pass runs again after a pause that doubles from five seconds to ten minutes.
export const makeReconciler = Effect.fnUntraced(function* <A, E>(
	pass: Effect.Effect<A, E>,
	finished: (outcome: A) => boolean
) {
	const wake = yield* Queue.sliding<void>(1)
	const waiting = yield* Ref.make(Option.none<Deferred.Deferred<A, E>>())
	const retry = yield* Ref.make(Option.none<number>())
	yield* pipe(
		Effect.gen(function* () {
			yield* Option.match(yield* Ref.get(retry), {
				onNone: () => Queue.take(wake),
				onSome: failed =>
					Effect.raceFirst(
						Queue.take(wake),
						Effect.sleep(pipe(Duration.seconds(5), Duration.times(2 ** failed), Duration.min(Duration.minutes(10))))
					)
			})
			const served = yield* Ref.getAndSet(waiting, Option.none())
			const exit = yield* Effect.exit(pass)
			yield* Effect.forEach(Option.toArray(served), deferred => Deferred.done(deferred, exit), {
				concurrency: 1,
				discard: true
			})
			yield* Ref.update(retry, failed => {
				if (Exit.isSuccess(exit) && finished(exit.value)) return Option.none()
				return Option.some(
					Option.match(failed, {onNone: Function.constant(0), onSome: count => Number.min(count + 1, 7)})
				)
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
