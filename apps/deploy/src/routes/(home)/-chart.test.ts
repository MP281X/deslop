import {assert, it} from '@effect/vitest'

import {Array, DateTime} from 'effect'

import {chartTicks} from '#routes/(home)/-chart.ts'

it('puts ticks at real clock times inside the requested range', () => {
	const now = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-02T11:09:00Z'))
	for (const hours of [1, 24, 168]) {
		const ticks = chartTicks(hours, now)
		assert.isTrue(Array.every(ticks, tick => tick.x >= 0 && tick.x <= 100))
		assert.isTrue(Array.every(ticks, tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).minute % 15 === 0))
		assert.isTrue(Array.every(ticks, tick => tick.at <= now))
	}
	assert.isTrue(
		Array.every(chartTicks(168, now), tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).hour === 0)
	)
})
