import {Effect, MutableRef, Option, Queue, Schedule, Stream, pipe} from 'effect'

import {isDropped} from '#client/live-stream.ts'

// Registers the device's push token, then each rotation, for as long as it runs. Apps own expo-notifications so importing this helper never autolinks a native notification module.
export function registerPushTokens<T extends {data: string | number}, E, R, RE, RR>(
	listen: (listener: (token: T) => void) => {remove: () => void},
	read: Effect.Effect<T, E, R>,
	register: (token: string) => Effect.Effect<void, RE, RR>
) {
	return pipe(
		Stream.callback<string, never, R>(queue =>
			Effect.gen(function* () {
				const rotated = MutableRef.make(false)
				yield* Effect.acquireRelease(
					Effect.sync(() =>
						listen(token => {
							MutableRef.set(rotated, true)
							Queue.offerUnsafe(queue, `${token.data}`)
						})
					),
					subscription => Effect.sync(() => subscription.remove())
				)
				// A rotation that arrived while the first read ran is newer than its answer; a failed read leaves the listener waiting for one.
				const first = yield* pipe(
					read,
					Effect.tapError(error => Effect.logWarning('The push token could not be read', error)),
					Effect.option
				)
				if (MutableRef.get(rotated)) return
				yield* Effect.forEach(Option.toArray(first), token => Queue.offer(queue, `${token.data}`), {
					concurrency: 1,
					discard: true
				})
			})
		),
		Stream.changes,
		// Registration is idempotent by token: a dropped connection retries it a few times, a newer token replaces it, a refusal ends it.
		Stream.switchMap(token =>
			pipe(
				register(token),
				Effect.retry({schedule: Schedule.exponential('2 seconds'), times: 4, while: isDropped}),
				Effect.ignore({log: 'Warn', message: 'The push token was not registered'}),
				Stream.fromEffectDrain
			)
		),
		Stream.runDrain
	)
}
