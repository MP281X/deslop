import {assert, it} from '@effect/vitest'

import {Array, DateTime} from 'effect'

import {chartTicks} from '#routes/(home)/-chart.ts'

it('puts ticks at real clock times inside the requested range', () => {
	const now = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-02T11:09:00Z'))
	for (const minutes of [60, 1440, 10_080]) {
		const ticks = chartTicks(minutes, now)
		assert.isTrue(Array.every(ticks, tick => tick.x >= 0 && tick.x <= 100))
		assert.isTrue(Array.every(ticks, tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).minute % 15 === 0))
		assert.isTrue(Array.every(ticks, tick => tick.at <= now))
	}
	assert.isTrue(
		Array.every(chartTicks(10_080, now), tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).hour === 0)
	)
	const minute = chartTicks(1, now + 7000)
	assert.lengthOf(minute, 4)
	assert.isTrue(Array.every(minute, tick => tick.at % 15_000 === 0 && tick.x > 0 && tick.x <= 100))
	assert.isTrue(Array.every(chartTicks(10, now), tick => tick.at % 120_000 === 0))
})
