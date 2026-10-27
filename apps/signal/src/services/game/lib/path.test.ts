import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {route} from '#services/game/lib/path.ts'
import {TILE, makeTerrain, passable, stride} from '#services/game/lib/utils.ts'
import type {EntityKind, Point} from '#services/game/schema.ts'

const terrain = makeTerrain()
// Neighbouring tile pairs along x in a stretch of the world, with what lies on each side.
const pairs = Array.map(
	Array.cartesian(
		Array.range(-300, 300),
		Array.map(Array.range(-100, 100), row => row * 3)
	),
	pair => ({from: terrain.tile(pair[0], pair[1]), to: terrain.tile(pair[0] + 1, pair[1]), x: pair[0], z: pair[1]})
)

type Side = {kind: number; level: number}

function edge(predicate: (pair: {from: Side; to: Side}) => boolean) {
	const found = Option.getOrThrow(Array.findFirst(pairs, predicate))
	return {x: found.x + 0.5, z: found.z + 0.5}
}

// A full tile's step east from a tile's centre: whether the drone ends up across.
function across(kind: EntityKind, from: Point) {
	return Math.floor(stride(terrain, kind, from, 1, 0).x) > Math.floor(from.x)
}

it('keeps each kind of drone to the ground it is built for', () => {
	const shore = edge(pair => pair.from.kind !== TILE.Water && pair.to.kind === TILE.Water)
	const terrace = edge(
		pair => pair.from.kind !== TILE.Water && pair.to.kind !== TILE.Water && pair.to.level - pair.from.level === 2
	)
	const cliff = edge(
		pair => pair.from.kind !== TILE.Water && pair.to.kind !== TILE.Water && pair.to.level - pair.from.level >= 3
	)
	assert.deepStrictEqual(
		Array.map([shore, terrace, cliff], from => ({
			hauler: across('hauler', from),
			miner: across('miner', from),
			scout: across('scout', from)
		})),
		[
			{hauler: true, miner: false, scout: true},
			{hauler: false, miner: true, scout: true},
			{hauler: false, miner: false, scout: true}
		]
	)
})

it('routes ground drones only over steps they can take', () => {
	const trips = Array.map(Array.range(0, 39), index => ({
		from: {x: ((index * 37) % 200) - 100.5, z: ((index * 53) % 200) - 100.5},
		to: {x: ((index * 37) % 200) - 100.5 + 30 * Math.cos(index), z: ((index * 53) % 200) - 100.5 + 30 * Math.sin(index)}
	}))
	const routes = Array.flatMap(['miner', 'hauler'] as const, kind =>
		Array.flatMap(trips, trip =>
			Array.map(Option.toArray(route(terrain, kind, trip.from, trip.to, 6000)), points => ({
				kind,
				// The last point is the goal itself, inside the last tile.
				steps: Array.zip([trip.from, ...Array.dropRight(points, 1)], Array.dropRight(points, 1))
			}))
		)
	)
	assert.isAbove(routes.length, 40)
	assert.isTrue(
		Array.every(routes, trip => Array.every(trip.steps, step => passable(terrain, trip.kind, step[0], step[1])))
	)
})
