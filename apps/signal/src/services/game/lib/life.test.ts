import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {makeLife} from '#services/game/lib/life.ts'
import type {Body} from '#services/game/lib/life.ts'

const UNIT: Body = {
	act: 'idle',
	doing: 'private objective',
	health: 1,
	id: 2,
	kind: 'worker',
	team: 0,
	x: 0,
	yaw: 0,
	z: 0
}

it('keeps encounters and inventories private until the individual chooses what to report', () => {
	const life = makeLife()
	life.observe(UNIT, [{...UNIT, doing: 'secret cargo destination', id: 3, team: 1, x: 1}], 10, 12)
	assert.deepStrictEqual(life.person(2, 10).contacts, [1])
	assert.deepStrictEqual(life.core(0).contacts, [])
	assert.deepStrictEqual(life.core(0).facts, [])
	assert.notInclude(life.local(UNIT, 10, true).state, 'secret cargo destination')
	life.inspect(UNIT, {id: 7, items: {iron_plate: 9}, kind: 'storage', text: 'Opened a container.', x: 1, z: 0}, 11)
	life.report(UNIT, 12, 'I found a container.', [
		Option.getOrThrow(Array.findFirst(life.person(2, 12).facts, fact => fact.id === 7))
	])
	assert.deepStrictEqual(life.core(0).contacts, [])
	assert.deepStrictEqual(
		Array.map(life.core(0).facts, fact => fact.id),
		[7]
	)
	assert.strictEqual(Option.getOrThrow(Array.head(life.core(0).facts)).source, 2)
	life.inspect(UNIT, {id: 7, items: {}, kind: 'storage', text: 'Now empty.', x: 1, z: 0}, 13)
	assert.deepStrictEqual(Option.getOrThrow(Array.head(life.core(0).facts)).items, {iron_plate: 9})
	life.report(UNIT, 14, 'Communication address learned.', [], [1])
	assert.deepStrictEqual(life.core(0).contacts, [1])
})

it('distinguishes delivery, reading and accepting and does not silently discard unread objectives', () => {
	const life = makeLife()
	life.send(UNIT, 1, 1, 'Visit the ridge.', {_tag: 'Go', x: 10, z: 10}, [1])
	life.send(UNIT, 1, 2, 'Use caution.')
	assert.deepStrictEqual(life.person(2, 2).contacts, [])
	assert.strictEqual(life.person(2, 2).guidance, '')
	assert.strictEqual(life.person(2, 2).pending, undefined)
	life.read(UNIT, 3)
	assert.deepStrictEqual(life.person(2, 3).contacts, [1])
	assert.strictEqual(life.person(2, 3).intent, 'continue')
	assert.strictEqual(life.person(2, 3).inbox.length, 1)
	assert.deepStrictEqual(life.person(2, 3).pending, {_tag: 'Go', x: 10, z: 10})
	life.read(UNIT, 4)
	assert.deepStrictEqual(life.person(2, 4).pending, {_tag: 'Go', x: 10, z: 10})
	assert.strictEqual(life.person(2, 4).guidance, 'Use caution.')
})

it('accumulates anonymous overlapping passage, preserves its age when pollution changes and lets it fade', () => {
	const life = makeLife()
	for (const tick of Array.range(1, 20)) life.stamp({...UNIT, id: tick + 10}, tick)
	const worn = Option.getOrThrow(Array.head(life.traces(20)))
	assert.isAbove(worn.wear, 0.29)
	life.pollute(UNIT, 0.5, 40)
	assert.strictEqual(Option.getOrThrow(Array.head(life.traces(40))).tick, 20)
	for (const tick of Array.range(1, 1000)) life.weather(tick * 20)
	const faded = Option.getOrThrow(Array.head(life.traces(20_000)))
	assert.isBelow(faded.wear, worn.wear)
	assert.isBelow(faded.smog, 0.001)
	assert.strictEqual(faded.fresh, 0)
})
