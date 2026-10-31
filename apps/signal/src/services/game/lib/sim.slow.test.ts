import {assert, it} from '@effect/vitest'

import {Array, Effect, MutableHashMap, Option, Predicate, Record, Schema} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {makeSim} from '#services/game/lib/sim.ts'
import {Sites} from '#services/game/lib/tasks.ts'
import {CREATURES, capsuleOf, nearestPair} from '#services/game/lib/utils.ts'
import {Frame, Saved, UnitKind} from '#services/game/schema.ts'
import type {Command, UnitView} from '#services/game/schema.ts'
import {makeWorld} from '#services/world/lib/utils.ts'

type Sim = Effect.Success<ReturnType<typeof makeSim>>

// Only fixture failures expose spectator diagnostics; agents never receive these observations.
function until<E>(sim: Sim, seconds: number, holds: Effect.Effect<boolean, E>) {
	return Effect.flatMap(
		Effect.repeat(Effect.andThen(sim.run(20), holds), {times: seconds - 1, until: Predicate.isTruthy}),
		held => {
			if (!held) {
				assert.fail(
					`${sim.observe(0).text}\nSpectator units:\n${Array.join(
						Array.map(sim.units(), unit => `#${unit.id} ${unit.doing} at (${unit.x}, ${unit.z}); load ${unit.load}`),
						'\n'
					)}\nRecent individual events:\n${Array.join(
						Array.map(sim.individual(2).recent, event => `${event.tick}: ${event.text}`),
						'\n'
					)}`
				)
			}
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
	const result = Option.getOrThrow(Array.head(sim.apply(0, [given])))
	// This factory scenario supplies cooperative local-model decisions; delivery alone is tested separately.
	if (given._tag === 'Order') {
		for (const unit of given.units) {
			sim.decide(unit, 'read')
			sim.decide(unit, 'accept')
		}
	}
	return result
}

// Cooperative fixture decisions still travel, inspect and stake through the public simulation interface.
const propose = Effect.fnUntraced(function* (
	sim: Sim,
	kind: Extract<Command, {_tag: 'Build'}>['kind'],
	points: {x: number; z: number}[]
) {
	const builder = Option.getOrThrow(Array.findFirst((yield* sim.snapshot).units, unit => unit.team === 0))
	for (const point of points) {
		const before = Array.map((yield* sim.snapshot).buildings, building => building.id)
		assert.isTrue(command(sim, {_tag: 'Build', kind, ...point}).ok)
		sim.decide(builder.id, 'read')
		sim.decide(builder.id, 'accept')
		yield* Effect.repeat(
			Effect.andThen(
				sim.run(20),
				Effect.map(
					sim.snapshot,
					saved =>
						Array.some(saved.buildings, building => !Array.contains(before, building.id)) ||
						Array.some(saved.units, unit => unit.id === builder.id && unit.order._tag !== 'Build')
				)
			),
			{times: 119, until: Predicate.isTruthy}
		)
		const found = Array.findFirst((yield* sim.snapshot).buildings, building => !Array.contains(before, building.id))
		if (Option.isSome(found)) return Option.getOrThrow(found).id
		command(sim, {_tag: 'Order', order: {_tag: 'Auto'}, units: [builder.id]})
	}
	return assert.fail(`No locally suitable ${kind} foundation in the fixture.`)
})

it.effect(
	'takes a team from Home and one Builder to a furnace, a miner and a second Builder, by hand',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 42)
		const saved = yield* sim.snapshot
		const home = yield* buildingOf(sim, (yield* team0(sim)).home)
		const builder = Option.getOrThrow(Array.findFirst(saved.units, unit => unit.team === 0)).id
		assert.deepStrictEqual(home.stock, {})
		const at = {x: home.x + 1, z: home.z + 1}
		const world = makeWorld(42)
		const fields = Array.getSomes(Array.map(Option.getOrThrow(Array.head(world.spawns())).fields, world.field))
		function fieldAt(material: string) {
			const field = Option.getOrThrow(Array.findFirst(fields, entry => entry.material === material))
			return {x: field.x, z: field.z}
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
		const furnaceId = yield* propose(
			sim,
			'furnace',
			Array.flatMap(Array.range(-8, 8), dz => Array.map(Array.range(-8, 8), dx => ({x: at.x + dx, z: at.z + dz})))
		)
		assert.isTrue(command(sim, {_tag: 'Order', order: {_tag: 'Auto'}, units: [builder]}).ok)
		assert.isTrue(yield* until(sim, 600, built(sim, furnaceId)))
		assert.isTrue(command(sim, {_tag: 'Recipe', building: furnaceId, recipe: 'furnace_iron_wood'}).ok)
		sim.decide(builder, 'read')
		sim.decide(builder, 'accept')
		yield* sim.run(2400)
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
		const minerId = yield* propose(
			sim,
			'miner_mk1',
			Array.flatMap(Array.range(-6, 6), dz => Array.map(Array.range(-6, 6), dx => ({x: iron.x + dx, z: iron.z + dz})))
		)
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
	})
)

it.effect(
	'refuses what a team cannot do yet, and says why',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 7)
		const home = yield* buildingOf(sim, (yield* team0(sim)).home)
		assert.isFalse(command(sim, {_tag: 'Build', kind: 'smelter', x: home.x + 4, z: home.z}).ok)
		assert.isTrue(command(sim, {_tag: 'Build', kind: 'furnace', x: home.x + 400, z: home.z}).ok)
		assert.strictEqual((yield* sim.snapshot).buildings.length, 3)
		assert.isFalse(command(sim, {_tag: 'Message', team: 1, text: 'hello'}).ok)
		assert.isFalse(command(sim, {_tag: 'Advance'}).ok)
		assert.match(sim.observe(0).text, /Next: t1 Workshop, paid at Home: 10 iron_plate, 10 iron_rod/u)
	})
)

it.effect(
	'keeps remote encounters private and radio positions independent of life or obedience',
	Effect.fnUntraced(function* () {
		const saved = yield* (yield* makeSim(Option.none(), 42)).snapshot
		const home = Option.getOrThrow(Array.head(saved.buildings))
		const at = {x: home.x + 50, z: home.z + 3}
		const encountered = yield* makeSim(
			Option.some({
				...saved,
				units: Array.map(saved.units, unit => {
					if (unit.id === 2) return {...unit, ...at}
					if (unit.id === 4) return {...unit, x: at.x + 2, z: at.z}
					return unit
				})
			}),
			0
		)
		encountered.decide(2, 'rest')
		encountered.decide(4, 'rest')
		yield* encountered.run(40)
		assert.deepStrictEqual(encountered.individual(2).contacts, [1])
		assert.isFalse(command(encountered, {_tag: 'Message', team: 1, text: 'Do not leak a private encounter.'}).ok)
		assert.isFalse(command(encountered, {_tag: 'Ping', unit: 2}).ok)
		const previous = yield* encountered.snapshot
		const silent = yield* makeSim(
			Option.some({
				...previous,
				units: Array.map(previous.units, unit => {
					if (unit.id !== 2) return unit
					return {...unit, health: 0, x: home.x + 30, z: home.z + 3}
				})
			}),
			0
		)
		const ping = command(silent, {_tag: 'Ping', unit: 2})
		assert.isTrue(ping.ok)
		assert.include(ping.text, 'does not establish life or health')
		assert.notInclude(silent.observe(0).text, 'down')
		assert.isFalse(command(silent, {_tag: 'Message', team: 1, text: 'Still unknown to this Core.'}).ok)
		assert.isFalse(command(silent, {_tag: 'Build', kind: 'road', to: {x: 1, z: 1}, x: 0, z: 0}).ok)
	})
)

it.effect(
	'does not reveal whether an inaccessible building ID exists',
	Effect.fnUntraced(function* () {
		const saved = yield* (yield* makeSim(Option.none(), 42)).snapshot
		const home = Option.getOrThrow(Array.head(saved.buildings))
		const sim = yield* makeSim(
			Option.some({
				...saved,
				buildings: [...saved.buildings, {...home, id: 324, kind: 'crate_mk1', x: home.x + 100}],
				nextId: 325
			}),
			0
		)
		assert.deepStrictEqual(command(sim, {_tag: 'Cancel', building: 324}), {
			...command(sim, {_tag: 'Cancel', building: 325}),
			command: {_tag: 'Cancel', building: 324}
		})
	})
)

it.effect(
	'lets an individual take unknown-team storage and keep the cargo until it chooses to deposit it',
	Effect.fnUntraced(function* () {
		const saved = yield* (yield* makeSim(Option.none(), 42)).snapshot
		const unit = Option.getOrThrow(Array.findFirst(saved.units, body => body.id === 2))
		const sim = yield* makeSim(
			Option.some({
				...saved,
				buildings: [
					...saved.buildings,
					{
						...Option.getOrThrow(Array.head(saved.buildings)),
						id: 324,
						kind: 'crate_mk1',
						stock: {iron_plate: 24},
						team: 1,
						x: Math.floor(unit.x) + 1,
						z: Math.floor(unit.z)
					}
				],
				nextId: 325
			}),
			0
		)
		sim.decide(2, 'rest')
		yield* sim.run(40)
		sim.decide(2, 'take:324')
		yield* sim.run(200)
		assert.strictEqual((yield* buildingOf(sim, 324)).stock.iron_plate, 14)
		assert.strictEqual(
			Option.getOrThrow(Array.findFirst((yield* sim.snapshot).units, body => body.id === 2)).cargo.iron_plate,
			10
		)
		assert.deepStrictEqual(sim.individual(2).contacts, [])
		assert.notInclude(sim.observe(1).text, '#324')
		sim.decide(2, 'deposit:324')
		yield* sim.run(100)
		assert.strictEqual((yield* buildingOf(sim, 324)).stock.iron_plate, 24)
		assert.deepStrictEqual(
			Option.getOrThrow(Array.findFirst((yield* sim.snapshot).units, body => body.id === 2)).cargo,
			{}
		)
	})
)

// How far a body turned, in radians, over a stretch in which it got less than a third of a tile anywhere.
it.effect(
	'enforces refit eligibility physically and releases a withdrawn paid refit without blocking production',
	Effect.fnUntraced(function* () {
		const saved = yield* (yield* makeSim(Option.none(), 42)).snapshot
		for (const mark of [0, 2]) {
			const sim = yield* makeSim(Option.some({...saved, units: Array.map(saved.units, unit => ({...unit, mark}))}), 0)
			command(sim, {_tag: 'Order', order: {_tag: 'Refit'}, units: [2]})
			yield* sim.run(1200)
			assert.deepStrictEqual((yield* team0(sim)).line, [])
			assert.strictEqual(
				Option.getOrThrow(Array.findFirst((yield* sim.snapshot).units, unit => unit.id === 2)).mark,
				mark
			)
		}
		const home = Option.getOrThrow(Array.head(saved.buildings))
		const sim = yield* makeSim(
			Option.some({
				...saved,
				buildings: Array.map(saved.buildings, building => ({...building, stock: {iron_plate: 8, iron_rod: 4}})),
				teams: Array.map(saved.teams, team => ({
					...team,
					gates: [...team.gates, 't4' as const],
					line: [{class: 'builder' as const, mark: 1, unit: 2}],
					lineProgress: 10
				})),
				units: Array.map(saved.units, unit => ({...unit, upgrade: false}))
			}),
			0
		)
		assert.isTrue(command(sim, {_tag: 'Make', unit: 'builder'}).ok)
		yield* sim.run(1)
		assert.deepStrictEqual((yield* buildingOf(sim, home.id)).stock, {
			circuit: 2,
			iron_plate: 8,
			iron_rod: 4,
			motor: 2,
			steel_beam: 4
		})
		yield* sim.run(500)
		assert.strictEqual(
			Array.countBy((yield* sim.snapshot).units, unit => unit.team === 0),
			2
		)
		assert.deepStrictEqual((yield* team0(sim)).line, [])
	})
)

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
			sim.decide(unit.id, 'read')
			sim.decide(unit.id, 'accept')
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
	})
)

it.effect(
	'sends frames that go over the wire',
	Effect.fnUntraced(function* () {
		const sim = yield* makeSim(Option.none(), 5)
		const connection = sim.connect()
		const wire = Schema.toCodecJson(Frame)
		yield* Effect.forEach(
			Array.range(1, 5),
			() => Effect.andThen(sim.run(2), () => Schema.encodeEffect(wire)(Option.getOrThrow(sim.frame(connection, 0)))),
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
			first.decide(unit.id, 'read')
			first.decide(unit.id, 'accept')
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
	})
)
