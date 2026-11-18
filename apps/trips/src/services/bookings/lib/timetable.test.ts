import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {segmentOf} from './timetable.ts'

import {PlaceCode} from '#services/bookings/schema.ts'

function stop(stopId: string, name: string) {
	return {
		arrival: Option.none(),
		departure: Option.none(),
		lat: 0,
		lon: 0,
		name,
		stopId: PlaceCode.make(stopId),
		tz: 'Europe/Rome'
	}
}

const RUN = [stop('rm', 'ROMA TERMINI'), stop('mr', 'MILANO ROGOREDO'), stop('mc', 'MILANO CENTRALE')]

function ends(found: ReturnType<typeof segmentOf>) {
	return Option.map(found, segment => [Array.map(segment.stops, item => item.stopId), segment.rank])
}

it('ends a train at the exact station even when a looser match comes first', () => {
	const from = {code: Option.some('rm'), name: 'Roma Termini'}
	assert.deepStrictEqual(
		ends(segmentOf(RUN, from, {code: Option.none(), name: 'Milano Centrale'})),
		Option.some([['rm', 'mr', 'mc'], 1])
	)
	// The stop id Transitous named for the printed station wins over a spelling that matches Rogoredo as loosely.
	assert.deepStrictEqual(
		ends(segmentOf(RUN, from, {code: Option.some('mc'), name: 'Milano C.le'})),
		Option.some([['rm', 'mr', 'mc'], 0])
	)
})
