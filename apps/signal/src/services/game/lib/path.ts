import {Array, MutableHashMap, MutableList, MutableRef, Number, Option} from 'effect'

import {STATS, pack, passable} from '#services/game/lib/utils.ts'
import type {Terrain} from '#services/game/lib/utils.ts'
import type {EntityKind, Point} from '#services/game/schema.ts'

// The 8 neighbours of a tile; a diagonal step costs √2.
const STEPS = [
	{cost: 1, x: 1, z: 0},
	{cost: 1, x: -1, z: 0},
	{cost: 1, x: 0, z: 1},
	{cost: 1, x: 0, z: -1},
	{cost: Math.SQRT2, x: 1, z: 1},
	{cost: Math.SQRT2, x: 1, z: -1},
	{cost: Math.SQRT2, x: -1, z: 1},
	{cost: Math.SQRT2, x: -1, z: -1}
]

type Node = {cost: number; key: number; x: number; z: number}
type Visit = {cost: number; from: number; x: number; z: number}

// Tile centres from just after the start to the given tile.
function trace(visits: MutableHashMap.MutableHashMap<number, Visit>, key: number): Point[] {
	return Option.match(MutableHashMap.get(visits, key), {
		onNone: () => [],
		onSome: visit => {
			if (visit.from === -1) return []
			return Array.append(trace(visits, visit.from), {x: visit.x + 0.5, z: visit.z + 0.5})
		}
	})
}

// The cheapest path of tile centres for a kind of unit, ending at the goal itself, or none when it is unreachable within the search budget; fliers go straight.
export function route(terrain: Terrain, kind: EntityKind, from: Point, to: Point, budget: number) {
	if (STATS[kind].climb >= 99) return Option.some([to])
	const goal = {x: Math.floor(to.x), z: Math.floor(to.z)}
	const start = {
		cost: 0,
		key: pack(Math.floor(from.x), Math.floor(from.z)),
		x: Math.floor(from.x),
		z: Math.floor(from.z)
	}
	const visits = MutableHashMap.make([start.key, {cost: 0, from: -1, x: start.x, z: start.z}])
	// A bucket queue: the straight-line estimate never overstates the cost, so the cheapest open bucket only moves up.
	const buckets = MutableHashMap.empty<number, MutableList.MutableList<Node>>()
	const cursor = MutableRef.make(0)
	const top = MutableRef.make(0)
	// Buckets are half a tile wide in estimated total cost.
	function queue(node: Node) {
		const bucket = Math.floor((node.cost + Math.hypot(goal.x - node.x, goal.z - node.z)) * 2)
		if (!MutableHashMap.has(buckets, bucket)) MutableHashMap.set(buckets, bucket, MutableList.make<Node>())
		Option.map(MutableHashMap.get(buckets, bucket), list => MutableList.append(list, node))
		MutableRef.set(top, Number.max(MutableRef.get(top), bucket))
	}
	queue(start)
	// Each round expands the cheapest open tile: none while the search goes on, then the path, or none inside once nothing is left to try.
	return Option.flatten(
		Array.reduce(Array.range(1, budget), Option.none<Option.Option<Point[]>>(), settled => {
			if (Option.isSome(settled)) return settled
			return Option.match(
				Array.findFirst(Array.range(MutableRef.get(cursor), MutableRef.get(top)), bucket =>
					Option.flatMap(MutableHashMap.get(buckets, bucket), list => {
						const node = MutableList.take(list)
						MutableRef.set(cursor, bucket)
						if (node === MutableList.Empty) return Option.none()
						return Option.some(node)
					})
				),
				{
					onNone: () => Option.some(Option.none()),
					onSome: node => {
						if (node.x === goal.x && node.z === goal.z) {
							return Option.some(Option.some(Array.append(trace(visits, node.key), to)))
						}
						const centre = {x: node.x + 0.5, z: node.z + 0.5}
						for (const step of STEPS) {
							const tile = {x: node.x + step.x, z: node.z + step.z}
							const cost = node.cost + step.cost
							// A diagonal needs both straight neighbours open too, so a path never cuts a cliff corner.
							const open =
								passable(terrain, kind, centre, {x: tile.x + 0.5, z: tile.z + 0.5}) &&
								passable(terrain, kind, centre, {x: tile.x + 0.5, z: centre.z}) &&
								passable(terrain, kind, centre, {x: centre.x, z: tile.z + 0.5})
							const cheaper = Option.match(MutableHashMap.get(visits, pack(tile.x, tile.z)), {
								onNone: () => true,
								onSome: visit => cost < visit.cost
							})
							if (open && cheaper) {
								MutableHashMap.set(visits, pack(tile.x, tile.z), {cost, from: node.key, ...tile})
								queue({cost, key: pack(tile.x, tile.z), ...tile})
							}
						}
						return Option.none<Option.Option<Point[]>>()
					}
				}
			)
		})
	)
}
