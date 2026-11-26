import {Effect, Schedule, pipe} from 'effect'

import {isDropped} from '#client/live-stream.ts'

// Registration is idempotent by token. Retry a dropped connection, never a refusal.
export function registerPushToken<E, R>(registration: Effect.Effect<void, E, R>) {
	return pipe(
		registration,
		Effect.retry({schedule: Schedule.exponential('2 seconds'), times: 4, while: isDropped}),
		Effect.ignore({log: 'Warn', message: 'The push token was not registered'})
	)
}
