import {Boolean, Clock, Effect, Number, Option, PubSub} from 'effect'

// A live snapshot is read immediately, then when state changes or its next expiry arrives; no polling.
export function waitForChange<A>(subscription: PubSub.Subscription<A>, previous: Option.Option<number>) {
	return Option.match(previous, {
		onNone: () => Effect.void,
		onSome: expiresAt =>
			Effect.raceFirst(
				PubSub.take(subscription),
				Boolean.match(expiresAt === Infinity, {
					onFalse: () => Effect.flatMap(Clock.currentTimeMillis, now => Effect.sleep(Number.max(0, expiresAt - now))),
					onTrue: () => Effect.never
				})
			)
	})
}
