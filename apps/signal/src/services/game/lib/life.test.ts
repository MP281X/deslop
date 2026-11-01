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
	life.send(
		UNIT,
		1,
		5,
		'Reported storage, not a live inventory.',
		undefined,
		[],
		[{id: 7, items: {wood: 4}, kind: 'storage', source: 9, text: 'Four wood reported.', tick: 2, x: 10, z: 10}]
	)
	assert.deepStrictEqual(life.person(2, 5).facts, [])
	life.read(UNIT, 6)
	assert.strictEqual(Option.getOrThrow(Array.head(life.person(2, 6).facts)).source, 9)
	assert.deepStrictEqual(Option.getOrThrow(Array.head(life.person(2, 6).facts)).via, [{from: 1, tick: 5}])
	life.inspect(UNIT, {id: 7, items: {}, kind: 'storage', text: 'Opened and found empty.', x: 10, z: 10}, 7)
	life.send(
		UNIT,
		1,
		8,
		'Stale report repeated.',
		undefined,
		[],
		[{id: 7, items: {wood: 4}, kind: 'storage', source: 9, text: 'Four wood reported.', tick: 2, x: 10, z: 10}]
	)
	life.read(UNIT, 9)
	assert.deepStrictEqual(Option.getOrThrow(Array.head(life.person(2, 9).facts)).items, {})
})

it('accumulates anonymous overlapping passage, preserves its age when pollution changes and lets it fade', () => {
	const life = makeLife()
	for (const tick of Array.range(1, 20)) life.stamp({...UNIT, id: tick + 10}, tick)
	const worn = Option.getOrThrow(Array.head(life.traces(20)))
	assert.isAbove(worn.wear, 0.29)
	life.stamp({...UNIT, kind: 'cart'}, 21)
	assert.deepStrictEqual(
		Array.map(Option.getOrThrow(Array.head(life.traces(21))).impressions ?? [], impression => impression.kind),
		['feet', 'wheels']
	)
	life.pollute(UNIT, 0.5, 40)
	assert.strictEqual(Option.getOrThrow(Array.head(life.traces(40))).tick, 21)
	for (const tick of Array.range(1, 1000)) life.weather(tick * 20)
	const faded = Option.getOrThrow(Array.head(life.traces(20_000)))
	assert.isBelow(faded.wear, worn.wear)
	assert.isBelow(faded.smog, 0.001)
	assert.strictEqual(faded.fresh, 0)
})

it('does not invent footprints for pollution or flying bodies and keeps provider metadata out of private experience', () => {
	const life = makeLife()
	assert.strictEqual(life.visibility(UNIT, 0), 1)
	life.pollute(UNIT, 0.5, 100)
	assert.isBelow(life.visibility(UNIT, 0), 1)
	life.stamp({...UNIT, kind: 'bird', x: 2}, 100)
	assert.strictEqual(life.traces(100).length, 49)
	assert.strictEqual(Option.getOrThrow(Array.head(life.traces(100))).fresh, 0)
	life.event(UNIT, 101, 'damage', 'An unidentified impact.', 7)
	for (const tick of Array.range(102, 140)) {
		life.event(UNIT, tick, 'decision', 'Chose continue: Continue the current task.')
	}
	life.event(UNIT, 141, 'decision', 'Provider accounting only.', undefined, {
		context: 'private provider input',
		tokens: {cost: 0.1}
	})
	assert.notInclude(life.local(UNIT, 141, true).state, 'Provider accounting only')
	assert.isTrue(
		Array.some(life.local(UNIT, 141, true).experience ?? [], entry => entry.text === 'An unidentified impact.')
	)
	const restored = makeLife(life.snapshot(), life.drain())
	assert.deepStrictEqual(restored.drain(), life.drain())
	assert.strictEqual(Option.getOrThrow(Array.last(restored.drain())).tokens?.cost, 0.1)
	assert.strictEqual(Option.getOrThrow(Array.last(restored.drain())).team, 0)
	assert.isTrue(Array.every(life.person(2, 141).recent, entry => entry.team === undefined))
})
