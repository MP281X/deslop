import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration} from 'effect'

import {chartTicks} from '#routes/(home)/-chart.ts'

it('puts ticks at real clock times inside the requested range', () => {
	const now = DateTime.makeUnsafe('2026-11-02T11:09:00Z')
	for (const minutes of [60, 1440, 10_080]) {
		const ticks = chartTicks(Duration.minutes(minutes), now)
		assert.isTrue(Array.every(ticks, tick => tick.x >= 0 && tick.x <= 100))
		assert.isTrue(Array.every(ticks, tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).minute % 15 === 0))
		assert.isTrue(Array.every(ticks, tick => tick.at <= DateTime.toEpochMillis(now)))
	}
	assert.isTrue(
		Array.every(
			chartTicks(Duration.minutes(10_080), now),
			tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).hour === 0
		)
	)
	const minute = chartTicks(Duration.minutes(1), DateTime.addDuration(now, Duration.seconds(7)))
	assert.lengthOf(minute, 4)
	assert.isTrue(Array.every(minute, tick => tick.at % 15_000 === 0 && tick.x > 0 && tick.x <= 100))
	assert.isTrue(Array.every(chartTicks(Duration.minutes(10), now), tick => tick.at % 120_000 === 0))
})
