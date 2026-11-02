import {assert, it} from '@effect/vitest'

import {Array, DateTime} from 'effect'

import {chartBucket, chartTicks, rateScale} from '#routes/(home)/-chart.ts'

it('puts ticks at real clock times and clips edge buckets to the requested range', () => {
	const now = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-02T11:09:00Z'))
	for (const hours of [1, 24, 168]) {
		const ticks = chartTicks(hours, now)
		assert.isTrue(Array.every(ticks, tick => tick.x >= 0 && tick.x <= 100))
		assert.isTrue(Array.every(ticks, tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).minute % 15 === 0))
		assert.isAtMost(chartBucket(hours, now, now).x + chartBucket(hours, now, now).width, 100)
		assert.isAtLeast(chartBucket(hours, now, now - hours * 3_600_000).x, 0)
	}
	assert.isTrue(
		Array.every(chartTicks(168, now), tick => DateTime.toParts(DateTime.makeZonedUnsafe(tick.at)).hour === 0)
	)
})

it('uses a legible 1–2–5 binary-unit rate ceiling without clipping observations', () => {
	for (const value of [0, 900, 200_000, 9_500_000, 1024 ** 3]) {
		const scale = rateScale(value)
		assert.isAtLeast(scale.maximum, value)
		assert.isAtMost(scale.label.length, 5)
	}
})
