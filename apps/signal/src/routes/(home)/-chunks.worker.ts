import {Array, MutableHashMap, Option, Schema} from 'effect'

import {buildChunk} from './-mesh.ts'

import {makeWorld, tileKey} from '#services/world/lib/utils.ts'
import type {Chunk, World} from '#services/world/lib/utils.ts'
import {TileChange} from '#services/world/schema.ts'

type Request = typeof Request.Type
// What the page asks: the world's seed once, tile changes as they stream in, and chunks to build.
const Request = Schema.TaggedUnion({
	Build: {cx: Schema.Int, cz: Schema.Int, revision: Schema.Int},
	Changes: {changes: Schema.Array(TileChange)},
	Seed: {seed: Schema.Int}
})

const state = {
	cache: MutableHashMap.empty<number, Chunk>(),
	overlay: {
		amounts: MutableHashMap.empty<number, number>(),
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

function apply(request: Extract<Request, {_tag: 'Changes'}>) {
	for (const change of request.changes) {
		const key = tileKey(change.x, change.z)
		if (change.amount !== undefined) MutableHashMap.set(state.overlay.amounts, key, change.amount)
		if (change.edit !== undefined) MutableHashMap.set(state.overlay.edits, key, change.edit)
	}
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

self.addEventListener('message', (event: MessageEvent) => {
	Option.match(Schema.decodeUnknownOption(Request)(event.data), {
		onNone: () => undefined,
		onSome: request => {
			if (request._tag === 'Seed') state.world = Option.some(makeWorld(request.seed))
			if (request._tag === 'Changes') apply(request)
			if (request._tag === 'Build') {
				Option.match(state.world, {
					onNone: () => undefined,
					onSome: world => build(world, request.cx, request.cz, request.revision)
				})
			}
		}
	})
})
