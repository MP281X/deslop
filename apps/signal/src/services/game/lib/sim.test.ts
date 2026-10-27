import {assert, it} from '@effect/vitest'

import {Array, Number, Option, String} from 'effect'

import {makeWorld} from '#services/game/lib/sim.ts'
import {STATS, STRIDE} from '#services/game/lib/utils.ts'

const ALICE = {id: '1', name: 'alice'}
const BOB = {id: '2', name: 'bob'}
const CORE = {planner: 'ready' as const}

function base(world: ReturnType<typeof makeWorld>, id: string) {
	const found = Option.getOrThrow(String.match(/base at (-?\d+),(-?\d+)/u)(world.summary(id)))
	return {x: Option.getOrThrow(Number.parse(found[1] ?? '')), z: Option.getOrThrow(Number.parse(found[2] ?? ''))}
}

function goto(world: ReturnType<typeof makeWorld>, id: string, offset: number) {
	const home = base(world, id)
	return {
		_tag: 'Assign',
		routine: {_tag: 'Goto', target: {x: home.x + offset, z: home.z + offset}},
		selector: {kind: 'scout'}
	} as const
}

function seen(world: ReturnType<typeof makeWorld>, connection: number, now: number) {
	const frame = world.frame(connection, now, CORE)
	assert.isDefined(frame)
	return {
		count: frame.positions.byteLength / 4 / STRIDE,
		hud: frame.hud,
		owners: Array.dedupe(Array.map(frame.entities, entity => entity.owner))
	}
}

it('shows a team its own fleet and keeps a distant stranger in the fog', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	world.connect(BOB, 0)
	for (const tick of Array.range(1, 40)) world.step(tick * 50)
	const view = seen(world, alice, 2000)
	assert.deepStrictEqual([view.owners, view.count, view.hud?.players], [['alice'], 9, ['alice', 'bob']])
})

it('refuses destinations the team has never seen and accepts explored ones', () => {
	const world = makeWorld(Option.none())
	world.connect(ALICE, 0)
	assert.deepStrictEqual(
		[world.act(ALICE.id, goto(world, ALICE.id, 900), 0).ok, world.act(ALICE.id, goto(world, ALICE.id, 10), 0).ok],
		[false, true]
	)
})

it('refuses routines outside a drone role and fabrication that builds nothing', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	world.step(50)
	const before = seen(world, alice, 100).count
	assert.deepStrictEqual(
		[
			world.act(
				ALICE.id,
				{_tag: 'Assign', routine: {_tag: 'Build', at: {x: 4, z: 4}, structure: 'turret'}, selector: {kind: 'scout'}},
				0
			).ok,
			world.act(ALICE.id, {_tag: 'Fabricate', count: 0, kind: 'guard'}, 0).ok,
			seen(world, alice, 2000).count
		],
		[false, false, before]
	)
})

it('moves a player who opens an invite next to the inviter and into the team', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	const invite = seen(world, alice, 2000).hud?.invite
	world.connect(BOB, 0)
	const bob = world.connect(BOB, 10, invite)
	assert.deepStrictEqual(
		[
			Array.map(seen(world, bob, 4000).hud?.team ?? [], member => member.name),
			Math.hypot(base(world, BOB.id).x - base(world, ALICE.id).x, base(world, BOB.id).z - base(world, ALICE.id).z) < 60
		],
		[['alice', 'bob'], true]
	)
})

it('keeps one memory entry per subject and drops it on forget', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	world.connect(BOB, 0)
	world.act(ALICE.id, {_tag: 'Remember', player: 'bob', stance: 'friendly', text: 'traded ore'}, 0)
	world.act(ALICE.id, {_tag: 'Remember', player: 'bob', stance: 'hostile', text: 'shot our hauler'}, 10)
	assert.deepStrictEqual(
		Array.map(seen(world, alice, 2000).hud?.memory ?? [], entry => [
			entry.key,
			entry._tag === 'Standing' && entry.stance
		]),
		[['standing:2', 'hostile']]
	)
	world.act(ALICE.id, {_tag: 'Forget', key: 'standing:2'}, 20)
	assert.deepStrictEqual(seen(world, alice, 4000).hud?.memory, [])
})

it('keeps drones sent to one spot apart from each other and from the core', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	const home = base(world, ALICE.id)
	for (const kind of ['scout', 'miner', 'hauler', 'guard', 'builder'] as const) {
		world.act(ALICE.id, {_tag: 'Assign', routine: {_tag: 'Goto', target: home}, selector: {kind}}, 0)
	}
	for (const tick of Array.range(1, 300)) world.step(tick * 50)
	const frame = world.frame(alice, 15_100, CORE)
	assert.isDefined(frame)
	const records = Array.chunksOf(Array.fromIterable(new Float32Array(Uint8Array.from(frame.positions).buffer)), STRIDE)
	function size(id: number) {
		return Option.getOrElse(
			Option.map(
				Array.findFirst(frame?.entities ?? [], entity => entity.id === id),
				entity => STATS[entity.kind].size
			),
			() => 0
		)
	}
	// The closest pair, as a fraction of the distance their sizes keep between them.
	assert.isAbove(
		Array.reduce(Array.cartesian(records, records), 99, (nearest, pair) => {
			if (pair[0][0] === pair[1][0]) return nearest
			return Number.min(
				nearest,
				Math.hypot((pair[0][1] ?? 0) - (pair[1][1] ?? 0), (pair[0][2] ?? 0) - (pair[1][2] ?? 0)) /
					(size(pair[0][0] ?? 0) + size(pair[1][0] ?? 0))
			)
		}),
		0.9
	)
})

it('brings mined ore home to the base the drones crowd around', () => {
	const world = makeWorld(Option.none())
	const alice = world.connect(ALICE, 0)
	for (const tick of Array.range(1, 4800)) world.step(tick * 50)
	assert.isAbove(seen(world, alice, 240_100).hud?.ore ?? 0, 120)
})

it('restores fleets, memory and explored ground from a snapshot', () => {
	const world = makeWorld(Option.none())
	world.connect(ALICE, 0)
	world.act(ALICE.id, {_tag: 'Remember', at: {x: 4, z: 4}, name: 'north ridge', text: 'ore field'}, 0)
	const restored = makeWorld(Option.some(world.snapshot()))
	restored.restore(0)
	// The event log is transient; fleet, structures and memory survive.
	assert.strictEqual(
		Array.headNonEmpty(String.split(restored.summary(ALICE.id), 'Recent events')),
		Array.headNonEmpty(String.split(world.summary(ALICE.id), 'Recent events'))
	)
	assert.isTrue(restored.act(ALICE.id, goto(restored, ALICE.id, 10), 0).ok)
})
