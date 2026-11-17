import {Duration, Effect, Stream, pipe} from 'effect'

// Queue invalidations, not reads: retain the latest during a read and its cooldown.
export function liveRead<A, E, R>(read: Effect.Effect<A, E, R>) {
	return <E2, R2>(invalidations: Stream.Stream<unknown, E2, R2>) =>
		pipe(
			invalidations,
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.flatMap(() =>
				Stream.concat(Stream.fromEffect(read), Stream.fromEffectDrain(Effect.sleep(Duration.seconds(1))))
			)
		)
}
