import {assert, it} from '@effect/vitest'

import {Array, Effect, MutableHashMap, Number, Option, Predicate, Record, Schema, String} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {makeSim} from '#services/game/lib/sim.ts'
import {Sites} from '#services/game/lib/tasks.ts'
import {CREATURES, capsuleOf, nearestPair} from '#services/game/lib/utils.ts'
import {Frame, Saved, UnitKind} from '#services/game/schema.ts'
import type {Command, UnitView} from '#services/game/schema.ts'

type Sim = Effect.Success<ReturnType<typeof makeSim>>

// Runs the world a second at a time until a condition holds; if it never did within the seconds given, fails with what team 0 sees.
function until<E>(sim: Sim, seconds: number, holds: Effect.Effect<boolean, E>) {
	return Effect.flatMap(
		Effect.repeat(Effect.andThen(sim.run(20), holds), {times: seconds - 1, until: Predicate.isTruthy}),
		held => {
			if (!held) assert.fail(sim.observe(0).text)
			return Effect.succeed(held)
		}
	)
}

const team0 = Effect.fnUntraced(function* (sim: Sim) {
	return Option.getOrThrow(Array.findFirst((yield* sim.snapshot).teams, team => team.id === 0))
})

const buildingOf = Effect.fnUntraced(function* (sim: Sim, id: number) {
	return Option.getOrThrow(Array.findFirst((yield* sim.snapshot).buildings, building => building.id === id))
})

const homeStock = Effect.fnUntraced(function* (sim: Sim) {
	return (yield* buildingOf(sim, (yield* team0(sim)).home)).stock
})

const built = Effect.fnUntraced(function* (sim: Sim, id: number) {
	return Sites.root.matches(yield* Machine.decodeSnapshot(Sites, (yield* buildingOf(sim, id)).site), 'Complete')
})

const builderOrder = Effect.fnUntraced(function* (sim: Sim, id: number) {
	return Option.getOrThrow(Array.findFirst((yield* sim.snapshot).units, unit => unit.id === id)).order._tag
})

function command(sim: Sim, given: Command) {
	return Option.getOrThrow(Array.head(sim.apply(0, [given])))
}

// A number caught by a pattern's first group.
function caught(text: string, pattern: RegExp, group: number) {
	return Option.getOrThrow(
		Option.flatMap(
			Option.flatMap(String.match(pattern)(text), found => Option.fromUndefinedOr(found[group])),
			Number.parse
		)
	)
}

it.effect(
	'takes a team from Home and one Builder to a furnace, a miner and a second Builder, by hand',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 42)
		const saved = yield* sim.snapshot
		const home = yield* buildingOf(sim, (yield* team0(sim)).home)
		const builder = Option.getOrThrow(Array.findFirst(saved.units, unit => unit.team === 0)).id
		assert.deepStrictEqual(home.stock, {})
		const at = {x: home.x + 1, z: home.z + 1}
		const fields = Option.getOrThrow(
			Array.findFirst(String.split('\n')(sim.observe(0).text), String.startsWith('Ore fields seen'))
		)
		function fieldAt(material: string) {
			const pattern = new RegExp(`${material} field at \\((-?\\d+), (-?\\d+)\\)`, 'u')
			return {x: caught(fields, pattern, 1), z: caught(fields, pattern, 2)}
		}
		const iron = fieldAt('iron')
		function stocked(item: 'iron_ingot' | 'iron_ore' | 'stone' | 'wood', count: number) {
			return Effect.map(homeStock(sim), stock => (stock[item] ?? 0) >= count)
		}
		// Stone first, from the start's stone field, for the furnace and the miner.
		assert.isTrue(
			command(sim, {_tag: 'Order', order: {_tag: 'Gather', item: 'stone', ...fieldAt('stone')}, units: [builder]}).ok
		)
		assert.isTrue(yield* until(sim, 900, stocked('stone', 14)))
		const furnace = Option.getOrThrow(
			Array.findFirst(
				Array.flatMap(Array.range(-8, 8), dz => Array.map(Array.range(-8, 8), dx => ({x: at.x + dx, z: at.z + dz}))),
				spot =>
					Option.liftPredicate(command(sim, {_tag: 'Build', kind: 'furnace', x: spot.x, z: spot.z}), entry => entry.ok)
			)
		)
		const furnaceId = caught(furnace.text, /#(\d+)/u, 1)
		assert.isTrue(command(sim, {_tag: 'Order', order: {_tag: 'Auto'}, units: [builder]}).ok)
		assert.isTrue(yield* until(sim, 600, built(sim, furnaceId)))
		assert.isTrue(command(sim, {_tag: 'Recipe', building: furnaceId, recipe: 'furnace_iron_wood'}).ok)
		// Wood and iron ore by hand, then into the furnace and its ingots back Home.
		assert.isTrue(
			command(sim, {_tag: 'Order', order: {_tag: 'Gather', item: 'wood', x: at.x, z: at.z}, units: [builder]}).ok
		)
		assert.isTrue(yield* until(sim, 900, stocked('wood', 12)))
		assert.isTrue(
			command(sim, {_tag: 'Order', order: {_tag: 'Gather', item: 'iron_ore', ...iron}, units: [builder]}).ok
		)
		assert.isTrue(yield* until(sim, 1200, stocked('iron_ore', 24)))
		const backOnAuto = Effect.map(builderOrder(sim, builder), order => order === 'Auto')
		assert.isTrue(
			command(sim, {
				_tag: 'Order',
				order: {_tag: 'Haul', count: 12, from: home.id, item: 'wood', to: furnaceId},
				units: [builder]
			}).ok
		)
		assert.isTrue(yield* until(sim, 600, backOnAuto))
		assert.isTrue(
			command(sim, {
				_tag: 'Order',
				order: {_tag: 'Haul', count: 24, from: home.id, item: 'iron_ore', to: furnaceId},
				units: [builder]
			}).ok
		)
		assert.isTrue(yield* until(sim, 900, backOnAuto))
		assert.isTrue(
			command(sim, {
				_tag: 'Order',
				order: {_tag: 'Haul', count: 24, from: furnaceId, item: 'iron_ingot', to: home.id},
				units: [builder]
			}).ok
		)
		assert.isTrue(yield* until(sim, 900, stocked('iron_ingot', 24)))
		// A miner on the iron field, and a second Builder off Home's line.
		assert.isTrue(command(sim, {_tag: 'Order', order: {_tag: 'Auto'}, units: [builder]}).ok)
		const miner = Option.getOrThrow(
			Array.findFirst(
				Array.flatMap(Array.range(-6, 6), dz =>
					Array.map(Array.range(-6, 6), dx => ({x: iron.x + dx, z: iron.z + dz}))
				),
				spot =>
					Option.liftPredicate(
						command(sim, {_tag: 'Build', kind: 'miner_mk1', x: spot.x, z: spot.z}),
						entry => entry.ok
					)
			)
		)
		const minerId = caught(miner.text, /#(\d+)/u, 1)
		assert.isTrue(command(sim, {_tag: 'Craft', count: 4, recipe: 'bench_iron_plate'}).ok)
		assert.isTrue(command(sim, {_tag: 'Craft', count: 4, recipe: 'bench_iron_rod'}).ok)
		assert.isTrue(command(sim, {_tag: 'Make', unit: 'builder'}).ok)
		assert.isTrue(
			yield* until(
				sim,
				900,
				Effect.map(
					sim.snapshot,
					saving => Array.countBy(saving.units, unit => unit.team === 0 && unit.class === 'builder') === 2
				)
			)
		)
		assert.isTrue(yield* until(sim, 600, built(sim, minerId)))
		assert.isTrue(
			yield* until(
				sim,
				120,
				Effect.map(buildingOf(sim, minerId), building => (building.output.iron_ore ?? 0) > 0)
			)
		)
	}),
	{timeout: 240_000}
)

it.effect(
	'refuses what a team cannot do yet, and says why',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 7)
		const home = yield* buildingOf(sim, (yield* team0(sim)).home)
		assert.isFalse(command(sim, {_tag: 'Build', kind: 'smelter', x: home.x + 4, z: home.z}).ok)
		assert.isFalse(command(sim, {_tag: 'Build', kind: 'furnace', x: home.x + 400, z: home.z}).ok)
		assert.isFalse(command(sim, {_tag: 'Message', team: 1, text: 'hello'}).ok)
		assert.isFalse(command(sim, {_tag: 'Advance'}).ok)
		assert.match(sim.observe(0).text, /Next: t1 Workshop, paid at Home: 10 iron_plate, 10 iron_rod/u)
	})
)

// How far a body turned, in radians, over a stretch in which it got less than a third of a tile anywhere.
function swayOf(track: {x: number; yaw: number; z: number}[]) {
	const first = Option.getOrThrow(Array.head(track))
	const last = Option.getOrThrow(Array.last(track))
	if (Math.hypot(last.x - first.x, last.z - first.z) >= 0.3) return 0
	return Array.reduce(
		Array.zip(track, Array.drop(track, 1)),
		0,
		(sum, pair) => sum + Math.abs(Math.atan2(Math.sin(pair[1].yaw - pair[0].yaw), Math.cos(pair[1].yaw - pair[0].yaw)))
	)
}

// How deep two bodies' footprints overlap, in tiles.
function overlapOf(first: UnitView, second: UnitView) {
	const one = capsuleOf(first)
	const other = capsuleOf(second)
	const nearest = nearestPair(one, other)
	return one.radius + other.radius - Math.hypot(nearest.to.x - nearest.from.x, nearest.to.z - nearest.from.z)
}

it.effect(
	'keeps bodies apart, and wildlife and hostiles from swaying in place among the trees',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 42)
		// Every team's Builder clears trees round its Home, out among the wildlife.
		for (const unit of (yield* sim.snapshot).units) {
			sim.apply(unit.team, [
				{
					_tag: 'Order',
					order: {_tag: 'Gather', item: 'wood', x: Math.floor(unit.x) + 6, z: Math.floor(unit.z) + 6},
					units: [unit.id]
				}
			])
		}
		const connection = sim.connect()
		const tracks = MutableHashMap.empty<number, {tenth: number; x: number; yaw: number; z: number}[]>()
		const overlaps = MutableHashMap.empty<string, number>()
		// Wildlife that flies, swarms or swims has no body on the ground.
		const airborne: Record.ReadonlyRecord<string, {life: string}> = CREATURES
		// Five minutes in tenths of a second; each body's last three seconds.
		const found = yield* Effect.forEach(
			Array.range(1, 3000),
			tenth =>
				Effect.map(sim.run(2), () => {
					const views = Option.getOrThrow(sim.frame(connection, tenth)).units
					const grounded: UnitView[] = Array.filter(
						views,
						body =>
							!Option.exists(Record.get(airborne, body.kind), creature => creature.life !== 'walker') &&
							body.kind !== 'loader' &&
							body.kind !== 'rotor' &&
							body.health > 0
					)
					const overlapping = Array.flatMap(grounded, (body, index) =>
						Array.flatMap(
							Array.filter(Array.drop(grounded, index + 1), other => overlapOf(body, other) > 0.15),
							(other: UnitView) => {
								const pair = `${body.kind} ${body.id} in ${other.kind} ${other.id}`
								const lasting = Option.contains(MutableHashMap.get(overlaps, pair), tenth - 1)
								MutableHashMap.set(overlaps, pair, tenth)
								if (!lasting) return []
								return [`${pair} at ${tenth / 10} s`]
							}
						)
					)
					const swaying = Array.flatMap(
						Array.filter(views, body => !Schema.is(UnitKind)(body.kind)),
						(body: UnitView) => {
							const before = Array.filter(
								Option.getOrElse(MutableHashMap.get(tracks, body.id), () => []),
								entry => entry.tenth > tenth - 30
							)
							const track = [...before, {tenth, x: body.x, yaw: body.yaw, z: body.z}]
							MutableHashMap.set(tracks, body.id, track)
							if (track.length < 30 || swayOf(track) < 2 * Math.PI) return []
							return [`${body.kind} ${body.id} sways at ${tenth / 10} s`]
						}
					)
					return [...overlapping, ...swaying]
				}),
			{concurrency: 1}
		)
		assert.deepStrictEqual(Array.flatten(found), [])
	}),
	{timeout: 240_000}
)

it.effect(
	'sends frames that go over the wire',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 5)
		const connection = sim.connect()
		const wire = Schema.toCodecJson(Frame)
		yield* Effect.forEach(
			Array.range(1, 5),
			() => Effect.andThen(sim.run(20), () => Schema.encodeEffect(wire)(Option.getOrThrow(sim.frame(connection, 0)))),
			{concurrency: 1, discard: true}
		)
		assert.isTrue(Schema.is(Frame)(Option.getOrThrow(sim.frame(connection, 0))))
	})
)

it.effect(
	'goes on from a save exactly as it would have without one',
	Effect.fnUntraced(function* () {
		const first = yield* makeSim(Option.none(), 9001)
		for (const unit of (yield* first.snapshot).units) {
			first.apply(unit.team, [
				{
					_tag: 'Order',
					order: {_tag: 'Gather', item: 'stone', x: Math.floor(unit.x), z: Math.floor(unit.z)},
					units: [unit.id]
				}
			])
		}
		yield* first.run(1200)
		// Through the save's schema as JSON, as the world goes to disk.
		const disk = Schema.fromJsonString(Schema.toCodecJson(Saved))
		const second = yield* makeSim(
			Option.some(yield* Schema.decodeEffect(disk)(yield* Schema.encodeEffect(disk)(yield* first.snapshot))),
			0
		)
		yield* first.run(2400)
		yield* second.run(2400)
		assert.strictEqual(
			yield* Schema.encodeEffect(disk)(yield* second.snapshot),
			yield* Schema.encodeEffect(disk)(yield* first.snapshot)
		)
	}),
	{timeout: 120_000}
)
