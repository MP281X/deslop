import {assert, it} from '@effect/vitest'

import {Array, Number, Option, Schema, Tuple} from 'effect'

import {makeSim} from '#services/game/lib/sim.ts'
import {Saved} from '#services/game/schema.ts'
import {makeWorld} from '#services/world/lib/utils.ts'

const START = 1_000_000

// Runs the colony for whole seconds of game time.
function run(sim: ReturnType<typeof makeSim>, seconds: number) {
	Array.forEach(Array.range(1, seconds), second => sim.step(START + second * 1000, START + (second - 1) * 1000))
	return START + seconds * 1000
}

it('mines a start field and hauls its ore home', {timeout: 120_000}, () => {
	const sim = makeSim(Option.none(), START, 42)
	const world = makeWorld(sim.seed)
	const field = Option.getOrThrow(Option.flatMap(Array.head(world.spawn().fields), world.field))
	const connection = sim.connect('player', START)
	const before = Option.getOrThrow(sim.frame(connection, START, {planner: 'ready'})).hud?.stock[field.material] ?? 0
	assert.isTrue(sim.act({_tag: 'Mine', field: field.id}, START).ok)
	const end = run(sim, 400)
	assert.isAbove(
		Option.getOrThrow(sim.frame(connection, end, {planner: 'ready'})).hud?.stock[field.material] ?? 0,
		before
	)
})

it('hauls a field’s last part-bite home and frees its crew', {timeout: 120_000}, () => {
	const fresh = makeSim(Option.none(), START, 42)
	const world = makeWorld(fresh.seed)
	const field = Option.getOrThrow(Option.flatMap(Array.head(world.spawn().fields), world.field))
	// Every tile of the field worked out but one, which holds less than a bite.
	const amounts = Array.map(Array.range(0, field.tiles - 1), i =>
		Tuple.make(field.xs[i] ?? 0, field.zs[i] ?? 0, Number.max(0, 3 - i * 3))
	)
	const sim = makeSim(Option.some({...fresh.snapshot(), amounts}), START, 0)
	const connection = sim.connect('player', START)
	const before = Option.getOrThrow(sim.frame(connection, START, {planner: 'ready'})).hud?.stock[field.material] ?? 0
	assert.isTrue(sim.act({_tag: 'Mine', field: field.id}, START).ok)
	const hud = Option.getOrThrow(sim.frame(connection, run(sim, 300), {planner: 'ready'})).hud
	assert.strictEqual(hud?.stock[field.material], before + 3)
	assert.deepStrictEqual(hud?.jobs, [])
})

it('restores a saved colony as it was', {timeout: 60_000}, () => {
	const sim = makeSim(Option.none(), START, 7)
	sim.act({_tag: 'Mine', field: Option.getOrThrow(Array.head(makeWorld(sim.seed).spawn().fields))}, START)
	const end = run(sim, 60)
	// Through the save's schema as JSON, as the colony goes to disk.
	const disk = Schema.fromJsonString(Saved)
	assert.deepStrictEqual(
		makeSim(Option.some(Schema.decodeSync(disk)(Schema.encodeSync(disk)(sim.snapshot()))), end, 0).snapshot(),
		sim.snapshot()
	)
})
