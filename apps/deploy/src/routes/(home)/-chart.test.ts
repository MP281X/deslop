import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration} from 'effect'

import {chartTicks, spacedTicks} from '#routes/(home)/-chart.ts'

const ROME = DateTime.zoneMakeNamedUnsafe('Europe/Rome')

it('ticks a month weekly at local midnight across a daylight-saving change, up to its end', () => {
	const now = DateTime.makeUnsafe('2026-11-05T12:00:00Z')
	const ticks = chartTicks(Duration.days(30), now, ROME)
	assert.deepStrictEqual(
		Array.map(ticks, tick => DateTime.formatIsoZoned(DateTime.makeZonedUnsafe(tick.at, {timeZone: ROME}))),
		[
			'2026-10-13T00:00:00.000+02:00[Europe/Rome]',
			'2026-10-20T00:00:00.000+02:00[Europe/Rome]',
			'2026-10-27T00:00:00.000+01:00[Europe/Rome]',
			'2026-11-03T00:00:00.000+01:00[Europe/Rome]'
		]
	)
	assert.isTrue(Array.every(ticks, tick => tick.label))
})

it('ticks a week every local midnight, labelling every other day', () => {
	const now = DateTime.makeUnsafe('2026-11-05T12:00:00Z')
	const ticks = chartTicks(Duration.days(7), now, ROME)
	assert.strictEqual(ticks.length, 7)
	assert.deepStrictEqual(
		Array.map(ticks, tick => tick.label),
		[true, false, true, false, true, false, true]
	)
})

it('keeps only the axis labels that fit apart, none before the axis is measured', () => {
	const ticks = Array.map([25, 50, 75, 99], x => ({text: '06:00', x}))
	assert.deepStrictEqual(
		Array.map(spacedTicks(320)(ticks), tick => tick.x),
		[25, 50, 75, 99]
	)
	assert.deepStrictEqual(
		Array.map(spacedTicks(100)(ticks), tick => tick.x),
		[25, 75]
	)
	assert.deepStrictEqual(spacedTicks(0)(ticks), [])
})
