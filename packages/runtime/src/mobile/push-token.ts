import {Effect, Queue, Stream} from 'effect'

// Apps own expo-notifications so importing this helper never autolinks a native notification module.
export function pushTokens<T extends {data: string | number}, E, R>(
	listen: (listener: (token: T) => void) => {remove: () => void},
	read: Effect.Effect<T, E, R>
) {
	return Stream.changes(
		Stream.callback<string, E, R>(queue =>
			Effect.gen(function* () {
				yield* Effect.acquireRelease(
					Effect.sync(() =>
						listen(token => {
							Queue.offerUnsafe(queue, `${token.data}`)
						})
					),
					subscription => Effect.sync(() => subscription.remove())
				)
				yield* Queue.offer(queue, `${(yield* read).data}`)
			})
		)
	)
}
