import {Effect, MutableRef, Option, Queue, Stream, pipe} from 'effect'

import {registerPushToken} from '#client/push.ts'

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
		Stream.switchMap(token => Stream.fromEffectDrain(registerPushToken(register(token)))),
		Stream.runDrain
	)
}
