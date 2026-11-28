import {
	Array,
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Record,
	Schedule,
	Semaphore,
	Stream,
	pipe
} from 'effect'

import {SqlClient} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'

import {Activities} from '#activities/server.ts'
import type {RoundState} from '#activities/server.ts'
import {Flights} from '#flights/server.ts'
import {journeysOf} from '#flights/shared.ts'
import {activeWindow, alertsOf, expiredActivities} from '#push/policy.ts'
import {Push, asPushReadError, asPushSaveError} from '#push/server.ts'

// Each round shows the day's Live Activities and sends the alerts that came due; one follows every registration and every change of the flights, and one each half minute.
export class Rounds extends Context.Service<Rounds>()('@deslop/trips/rounds/server/Rounds', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const flights = yield* Flights
		const push = yield* Push
		const activities = yield* Activities
		const apns = yield* Apns

		const roundState = Effect.gen(function* () {
			return {activities: yield* activities.list, devices: yield* push.devices} satisfies RoundState
		})

		const ticking = yield* Semaphore.make(1)
		const tick = pipe(
			Effect.gen(function* () {
				if (!apns.enabled) return
				const now = yield* DateTime.now
				const all = yield* flights.list
				const state = yield* roundState
				const travel = yield* asPushReadError(flights.travel)
				const context = {flights: all, travel}
				const alerts = Record.fromIterableWith(all, flight => [flight.id, alertsOf(flight, now, context)] as const)
				const journeys = journeysOf(all)
				// The activities go first, so a change one tells itself is no notification as well.
				yield* Effect.forEach(
					journeys,
					journey =>
						pipe(
							activeWindow(journey, now, travel),
							Option.match({
								onNone: () => Effect.void,
								onSome: window => activities.show(journey, window, now, state, {alerts, travel})
							}),
							Effect.ignore({
								log: 'Warn',
								message: `The Live Activity of ${Array.headNonEmpty(journey).id} was not updated`
							})
						),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					all,
					flight =>
						Effect.ignore(push.announce(flight, now, alerts[flight.id] ?? []), {
							log: 'Warn',
							message: `The alerts of ${flight.id} were not sent`
						}),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					expiredActivities(state.activities, journeys, now, travel),
					activity =>
						Effect.ignore(activities.finish(activity, now), {log: 'Warn', message: 'An activity was not ended'}),
					{concurrency: 1, discard: true}
				)
				// Nothing reads an activity two days after it ended, or the alerts of a flight that left.
				yield* pipe(
					Effect.andThen(
						activities.forgetEndedBefore(DateTime.subtractDuration(now, Duration.days(2))),
						push.forgetAlertsExcept(Array.map(all, flight => flight.id))
					),
					sql.withTransaction,
					asPushSaveError
				)
			}),
			Semaphore.withPermit(ticking),
			Effect.withSpan('Push.round'),
			Effect.ignore({log: 'Warn', message: 'The push round failed'})
		)

		yield* pipe(tick, Effect.repeat(Schedule.spaced('30 seconds')), Effect.forkScoped)
		yield* Effect.forkScoped(
			pipe(
				flights.watch,
				Stream.debounce('2 seconds'),
				Stream.runForEach(() => tick),
				Effect.ignore({log: 'Warn', message: 'The flights stopped reaching the push rounds'})
			)
		)

		return {tick}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
