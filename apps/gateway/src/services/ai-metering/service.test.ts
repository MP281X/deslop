import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Effect, FileSystem, Function, Layer, Number, Option, Stream, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {AiMetering} from './service.ts'

import {AiProxy} from '#services/ai-proxy/service.ts'

const ACTIVE = UserId.make('github:1')
const DORMANT = UserId.make('github:2')

const layer = pipe(
	AiMetering.layer,
	Layer.provideMerge(AiProxy.migrations),
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provideMerge(NodeServices.layer)
)

// The test clock starts at zero and stands for the present: a far jump forward wakes every sleeping fiber at each of its steps, which takes minutes.
function daysAgo(days: number) {
	return -Duration.toMillis(Duration.days(days))
}

// A call the owner's key paid for, counted at the clock's present.
const countCall = Effect.fnUntraced(function* (owner: UserId) {
	const metering = yield* AiMetering
	yield* (yield* metering.observe(owner, 'anthropic', Option.none(), yield* DateTime.now, {accepted: true, sse: false}))
		.save
})

// The calls the thirty-day report shows with the clock at `epoch`. A call whose response reported no cost counts as one unknown-cost call, which is how the report counts calls.
const callsAt = Effect.fnUntraced(function* (owner: UserId, epoch: number) {
	yield* TestClock.setTime(epoch)
	return Option.match(yield* Stream.runHead((yield* AiMetering).usage(owner, '30d')), {
		onNone: Function.constant(0),
		onSome: value => Number.sumAll(Array.map(value.report.totals, total => total.unknownCostCalls))
	})
})

it.layer(layer)(test =>
	test.effect(
		'a counted call deletes only its own owner’s calls older than thirty days',
		Effect.fnUntraced(function* () {
			// A call counted at day 90 would be deleted by the owner's own later call at day 45, so the day-90 call comes second.
			for (const age of [45, 90]) {
				yield* TestClock.setTime(daysAgo(age))
				yield* countCall(ACTIVE)
				yield* countCall(DORMANT)
			}
			yield* TestClock.setTime(daysAgo(0))
			yield* countCall(ACTIVE)
			// The report shows thirty days back from the clock, so each row is read with the clock set to when it was counted.
			assert.deepStrictEqual(
				[yield* callsAt(ACTIVE, daysAgo(90)), yield* callsAt(ACTIVE, daysAgo(45)), yield* callsAt(ACTIVE, daysAgo(0))],
				[0, 0, 1]
			)
			assert.deepStrictEqual(
				[
					yield* callsAt(DORMANT, daysAgo(90)),
					yield* callsAt(DORMANT, daysAgo(45)),
					yield* callsAt(DORMANT, daysAgo(0))
				],
				[1, 1, 0]
			)
		})
	)
)
