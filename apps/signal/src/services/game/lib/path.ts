import {Array, MutableHashMap, MutableList, MutableRef, Number, Option} from 'effect'

import type {Point} from '#services/game/schema.ts'

// Tiles pack into one number for the search's maps; a search stays within ±32,768 tiles of the origin.
const SPAN = 65_536
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
// What one straight step from a tile costs for this mover, relative to plain ground: Infinity where it cannot go.
export type Walk = (x: number, z: number, dx: number, dz: number) => number

function pack(x: number, z: number) {
	return (x + SPAN / 2) * SPAN + (z + SPAN / 2)
}

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

// A diagonal step needs both straight steps round it open too, so a path never cuts a cliff corner.
function stepCost(walk: Walk, x: number, z: number, step: {cost: number; x: number; z: number}) {
	if (step.x === 0 || step.z === 0) return step.cost * walk(x, z, step.x, step.z)
	const sides = Number.max(
		Number.max(walk(x, z, step.x, 0), walk(x + step.x, z, 0, step.z)),
		Number.max(walk(x, z, 0, step.z), walk(x, z + step.z, step.x, 0))
	)
	return step.cost * sides
}

// The cheapest path of tile centres for a mover to a tile within `near` tiles of the goal (0: the goal itself), or none when it is unreachable within the search budget.
export function route(walk: Walk, from: Point, to: Point, options: {budget: number; near: number}) {
	const goal = {x: Math.floor(to.x), z: Math.floor(to.z)}
	const start = {
		cost: 0,
		key: pack(Math.floor(from.x), Math.floor(from.z)),
		x: Math.floor(from.x),
		z: Math.floor(from.z)
	}
	const visits = MutableHashMap.make([start.key, {cost: 0, from: -1, x: start.x, z: start.z}])
	// A bucket queue: the straight-line estimate never overstates the cost (plain ground is the cheapest but roads), so the cheapest open bucket only moves up.
	const buckets = MutableHashMap.empty<number, MutableList.MutableList<Node>>()
	const cursor = MutableRef.make(0)
	const top = MutableRef.make(0)
	// Buckets are half a tile wide in estimated total cost.
	function queue(node: Node) {
		const bucket = Math.floor((node.cost + 0.5 * Math.hypot(goal.x - node.x, goal.z - node.z)) * 2)
		if (!MutableHashMap.has(buckets, bucket)) MutableHashMap.set(buckets, bucket, MutableList.make<Node>())
		Option.map(MutableHashMap.get(buckets, bucket), list => MutableList.append(list, node))
		MutableRef.set(top, Number.max(MutableRef.get(top), bucket))
	}
	queue(start)
	MutableRef.set(cursor, MutableRef.get(top))
	// The cheapest open node, scanning up from the cursor without allocating: buckets below it stay empty.
	function pop() {
		while (MutableRef.get(cursor) <= MutableRef.get(top)) {
			const node = Option.flatMap(MutableHashMap.get(buckets, MutableRef.get(cursor)), list => {
				const taken = MutableList.take(list)
				if (taken === MutableList.Empty) return Option.none<Node>()
				return Option.some(taken)
			})
			if (Option.isSome(node)) return node
			MutableRef.set(cursor, MutableRef.get(cursor) + 1)
		}
		return Option.none<Node>()
	}
	// Each round expands the cheapest open tile: none while the search goes on, then the path, or none inside once nothing is left to try.
	return Option.flatten(
		Array.reduce(Array.range(1, options.budget), Option.none<Option.Option<Point[]>>(), settled => {
			if (Option.isSome(settled)) return settled
			return Option.match(pop(), {
				onNone: () => Option.some(Option.none()),
				onSome: node => {
					if (Math.abs(node.x - goal.x) <= options.near && Math.abs(node.z - goal.z) <= options.near) {
						return Option.some(Option.some(trace(visits, node.key)))
					}
					for (const step of STEPS) {
						const tile = {x: node.x + step.x, z: node.z + step.z}
						const cost = node.cost + stepCost(walk, node.x, node.z, step)
						const cheaper = Option.match(MutableHashMap.get(visits, pack(tile.x, tile.z)), {
							onNone: () => true,
							onSome: visit => cost < visit.cost
						})
						if (cheaper && cost < Infinity) {
							MutableHashMap.set(visits, pack(tile.x, tile.z), {cost, from: node.key, ...tile})
							queue({cost, key: pack(tile.x, tile.z), ...tile})
						}
					}
					return Option.none<Option.Option<Point[]>>()
				}
			})
		})
	)
}
