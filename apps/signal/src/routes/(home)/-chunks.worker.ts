import {Array, MutableHashMap, MutableHashSet, Option, Schema} from 'effect'

import {buildChunk} from './-mesh.ts'

import {CHUNK, makeWorld, tileKey} from '#services/world/lib/utils.ts'
import type {Chunk, World} from '#services/world/lib/utils.ts'
import {TileChange} from '#services/world/schema.ts'

type Request = typeof Request.Type
// What the page asks: the world's seed once, tile changes as they stream in, chunks to build, and what lies on a tile under the pointer.
const Request = Schema.TaggedUnion({
	Build: {cx: Schema.Int, cz: Schema.Int, revision: Schema.Int},
	Changes: {changes: Schema.Array(TileChange)},
	// Props the colonies cleared: the chunks this worker built with them are stale.
	Cleared: {ids: Schema.Array(Schema.Int)},
	// Where the pointer's ray meets the ground, and the way back along it toward the camera, over the ground.
	Inspect: {
		ask: Schema.Int,
		back: Schema.Struct({x: Schema.Finite, z: Schema.Finite}),
		x: Schema.Finite,
		z: Schema.Finite
	},
	// Back to the world as generated, for a stream that starts over.
	Reset: {},
	Seed: {seed: Schema.Int}
})

// The chunks a worker built with props since cleared, for the page to rebuild.
export type Stale = {_tag: 'Stale'; chunks: {cx: number; cz: number}[]}

// The field a tile belongs to, with the ore it has left, or the prop standing on it.
export type Inspected = {
	_tag: 'Inspected'
	ask: number
	field?: {left: number; material: string; tiles: number; total: number}
	prop?: string
}

const state = {
	cache: MutableHashMap.empty<number, Chunk>(),
	overlay: {
		amounts: MutableHashMap.empty<number, number>(),
		cleared: MutableHashSet.empty<number>(),
		edits: MutableHashMap.empty<number, TileChange['edit'] & {}>()
	},
	world: Option.none<World>()
}

function chunkAt(world: World) {
	return (cx: number, cz: number) => {
		const key = (cx + 4096) * 8192 + (cz + 4096)
		return Option.getOrElse(MutableHashMap.get(state.cache, key), () => {
			// Generated chunks stay for their neighbours' borders; past 400 the cache starts over.
			if (MutableHashMap.size(state.cache) > 400) MutableHashMap.clear(state.cache)
			const chunk = world.chunk(cx, cz)
			MutableHashMap.set(state.cache, key, chunk)
			return chunk
		})
	}
}

function reply(message: Inspected | Stale) {
	// oxlint-disable-next-line unicorn/require-post-message-target-origin -- A worker posts to the page that started it, with no origin to name.
	self.postMessage(message)
}

function apply(request: Extract<Request, {_tag: 'Changes'}>) {
	for (const change of request.changes) {
		const key = tileKey(change.x, change.z)
		if (change.amount !== undefined) MutableHashMap.set(state.overlay.amounts, key, change.amount)
		if (change.edit !== undefined) MutableHashMap.set(state.overlay.edits, key, change.edit)
	}
}

function clear(request: Extract<Request, {_tag: 'Cleared'}>) {
	for (const id of request.ids) MutableHashSet.add(state.overlay.cleared, id)
	const stale = {
		_tag: 'Stale',
		chunks: Array.map(
			Array.filter(Array.fromIterable(state.cache), entry =>
				Array.some(entry[1].props, prop => Array.contains(request.ids, prop.id))
			),
			entry => ({cx: Math.floor(entry[0] / 8192) - 4096, cz: (entry[0] % 8192) - 4096})
		)
	} satisfies Stale
	if (Array.isArrayNonEmpty(stale.chunks)) reply(stale)
}

function reset() {
	MutableHashMap.clear(state.overlay.amounts)
	MutableHashMap.clear(state.overlay.edits)
	MutableHashSet.clear(state.overlay.cleared)
}

function build(world: World, cx: number, cz: number, revision: number) {
	const built = buildChunk(chunkAt(world), state.overlay, cx, cz)
	const buffers = [
		built.corners.buffer,
		built.liquid.buffer,
		built.surface.buffer,
		...Array.flatMap([built.terrain, built.props, built.glow], mesh => [
			mesh.colors.buffer,
			mesh.normals.buffer,
			mesh.positions.buffer
		]),
		...Array.flatMap(built.liquids, liquid => [
			liquid.along.buffer,
			liquid.falls.buffer,
			liquid.positions.buffer,
			liquid.shore.buffer
		]),
		...Array.map(built.instances, group => group.data.buffer)
	]
	self.postMessage({...built, revision}, {transfer: buffers})
}

function inspect(world: World, request: Extract<Request, {_tag: 'Inspect'}>) {
	const tile = {x: Math.floor(request.x), z: Math.floor(request.z)}
	const cx = Math.floor(tile.x / CHUNK)
	const cz = Math.floor(tile.z / CHUNK)
	const chunk = chunkAt(world)(cx, cz)
	const field = Option.map(
		Array.get(chunk.fields, (chunk.field[(tile.z - cz * CHUNK) * CHUNK + tile.x - cx * CHUNK] ?? 0) - 1),
		found => {
			const amounts = Array.map(Array.range(0, found.tiles - 1), i =>
				Option.getOrElse(
					MutableHashMap.get(state.overlay.amounts, tileKey(found.xs[i] ?? 0, found.zs[i] ?? 0)),
					() => found.amts[i] ?? 0
				)
			)
			return {
				left: Array.reduce(amounts, 0, (sum, amount) => sum + amount),
				material: found.material,
				tiles: found.tiles,
				total: found.total
			}
		}
	)
	// A tree or rock stands in front of the ground the ray meets: the first prop back along the ray, up to three tiles.
	const near = Array.flatMap(Array.range(-1, 1), dz =>
		Array.flatMap(Array.range(-1, 1), dx => chunkAt(world)(cx + dx, cz + dz).props)
	)
	const prop = Array.findFirst(Array.range(0, 15), step => {
		const at = {x: request.x + request.back.x * step * 0.2, z: request.z + request.back.z * step * 0.2}
		return Array.findFirst(near, entry => Math.hypot(entry.x - at.x, entry.z - at.z) < 0.45 * entry.s)
	})
	reply({
		_tag: 'Inspected',
		ask: request.ask,
		...Option.getOrUndefined(Option.map(field, found => ({field: found}))),
		...Option.getOrUndefined(Option.map(prop, found => ({prop: found.kind})))
	})
}

self.addEventListener('message', (event: MessageEvent) => {
	Option.match(Schema.decodeUnknownOption(Request)(event.data), {
		onNone: () => undefined,
		onSome: request => {
			if (request._tag === 'Seed') state.world = Option.some(makeWorld(request.seed))
			if (request._tag === 'Changes') apply(request)
			if (request._tag === 'Cleared') clear(request)
			if (request._tag === 'Reset') reset()
			if (request._tag === 'Build') {
				Option.match(state.world, {
					onNone: () => undefined,
					onSome: world => build(world, request.cx, request.cz, request.revision)
				})
			}
			if (request._tag === 'Inspect') {
				Option.match(state.world, {onNone: () => undefined, onSome: world => inspect(world, request)})
			}
		}
	})
})
