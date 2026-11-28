import {assert, it} from '@effect/vitest'

import {DateTime, Duration, Effect, Option, Stream} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {usageWindow} from './window.ts'

it.layer(Reactivity.layer)(test =>
	test.effect(
		'opens each frame on the next bucket boundary',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(Duration.toMillis(Duration.seconds(90)))
			const window = Option.getOrThrow(yield* Stream.runHead(usageWindow('10m', [], () => Effect.succeed('report'))))
			assert.strictEqual(window.report, 'report')
			assert.strictEqual(DateTime.toEpochMillis(window.range.to), Duration.toMillis(Duration.minutes(2)))
			assert.strictEqual(DateTime.toEpochMillis(window.range.from), -Duration.toMillis(Duration.minutes(8)))
			assert.strictEqual(window.range.count, 10)
			assert.isTrue(Duration.equals(window.range.size, Duration.minutes(1)))
		})
	)
)
