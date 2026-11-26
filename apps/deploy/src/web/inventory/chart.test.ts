import {assert, it} from '@effect/vitest'

import {DateTime, Option} from 'effect'

import {axisPosition, restartPositions, tracePaths} from '#web/inventory/chart.ts'

function time(minute: number) {
	return DateTime.makeUnsafe(minute * 60_000)
}
const now = time(60)

it('aligns timestamps and restarts to the same trailing hour', () => {
	assert.strictEqual(axisPosition(time(15), now), 25)
	assert.deepStrictEqual(restartPositions([time(-1), time(15), time(60), time(61)], now), [25, 100])
})

it('clips a point at the left of the hour and leaves unread intervals blank', () => {
	const paths = tracePaths(
		[
			{from: time(-15), time: time(15), value: Option.some(20)},
			{from: time(15), time: time(30), value: Option.none()},
			{from: time(30), time: time(45), value: Option.some(0)},
			{from: time(45), time: time(60), value: Option.some(50)}
		],
		now
	)
	assert.strictEqual(paths.line, 'M0 80H25M50 100H75V50H100')
})
