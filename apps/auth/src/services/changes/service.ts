import {Boolean, Clock, Context, Effect, Layer, Number, Option, PubSub, Stream} from 'effect'

// One signal for every live view: a watch reads its value again after any saved change or when that value expires.
export class Changes extends Context.Service<
	Changes,
	{
		readonly publish: Effect.Effect<void>
		readonly watch: <A, E>(read: Effect.Effect<A, E>, expires: (value: A) => number) => Stream.Stream<A, E>
	}
>()('@deslop/auth/services/changes/service/Changes') {
	static readonly layer = Layer.effect(
		Changes,
		Effect.gen(function* () {
			const changes = yield* PubSub.sliding<true>(1)
			return Changes.of({
				publish: Effect.asVoid(PubSub.publish(changes, true)),
				watch: (read, expires) =>
					Stream.unwrap(
						Effect.map(PubSub.subscribe(changes), subscription =>
							Stream.unfold(Option.none<number>(), previous =>
								Effect.gen(function* () {
									yield* Option.match(previous, {
										onNone: () => Effect.void,
										onSome: expiresAt =>
											Effect.raceFirst(
												PubSub.take(subscription),
												Boolean.match(expiresAt === Infinity, {
													onFalse: () =>
														Effect.flatMap(Clock.currentTimeMillis, now =>
															Effect.sleep(Number.max(0, expiresAt - now))
														),
													onTrue: () => Effect.never
												})
											)
									})
									const value = yield* read
									return [value, Option.some(expires(value))] as const
								})
							)
						)
					)
			})
		})
	)
}
