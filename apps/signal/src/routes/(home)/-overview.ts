import {Array, MutableList, Option} from 'effect'

import * as THREE from 'three'

import type {Built} from './-mesh.ts'

import {CHUNK, GROUND_BIOME, GROUND_COLOR, LEVEL} from '#services/world/lib/utils.ts'
import type {World} from '#services/world/lib/utils.ts'

// Coarse terrain uses the same seed and height generator, never a second map or detailed prop/ore generation.
function empty() {
	return {colors: new Float32Array(), normals: new Float32Array(), positions: new Float32Array()}
}

function tileHeights(corners: Float32Array, level: number, x: number, z: number, step: number) {
	for (const row of Array.range(0, step - 1)) {
		for (const col of Array.range(0, step - 1)) {
			corners.set([level, level, level, level], ((z + row) * CHUNK + x + col) * 4)
		}
	}
}

export function overviewChunk(world: World, cx: number, cz: number) {
	const corners = new Float32Array(CHUNK * CHUNK * 4)
	const positions = MutableList.make<number>()
	const colors = MutableList.make<number>()
	const normals = MutableList.make<number>()
	const color = new THREE.Color()
	const step = 8
	for (const z of Array.range(0, CHUNK / step - 1)) {
		for (const x of Array.range(0, CHUNK / step - 1)) {
			const gx = cx * CHUNK + x * step
			const gz = cz * CHUNK + z * step
			const tile = world.tileAt(gx + step / 2, gz + step / 2)
			const ground = Option.getOrElse(
				Array.findFirstIndex(GROUND_BIOME, biome => biome === tile.biome),
				() => 0
			)
			color.set(GROUND_COLOR[tile.ground] ?? GROUND_COLOR[ground] ?? '#bcd59d')
			if (tile.liquid > 0) color.set('#79b6b3')
			for (const offset of [
				[0, 0],
				[0, step],
				[step, 0],
				[step, 0],
				[0, step],
				[step, step]
			]) {
				const px = gx + (offset[0] ?? 0)
				const pz = gz + (offset[1] ?? 0)
				MutableList.appendAll(positions, [px, world.tileAt(px, pz).level * LEVEL, pz])
				MutableList.appendAll(colors, [color.r, color.g, color.b])
				MutableList.appendAll(normals, [0, 1, 0])
			}
			tileHeights(corners, tile.level, x * step, z * step, step)
		}
	}
	return {
		corners,
		cx,
		cz,
		deck: Float32Array.from(Array.replicate(Infinity, CHUNK * CHUNK)),
		glow: empty(),
		instances: [],
		liquid: new Uint8Array(CHUNK * CHUNK),
		liquids: [],
		props: empty(),
		surface: new Float32Array(CHUNK * CHUNK),
		terrain: {
			colors: Float32Array.from(MutableList.toArray(colors)),
			normals: Float32Array.from(MutableList.toArray(normals)),
			positions: Float32Array.from(MutableList.toArray(positions))
		}
	} satisfies Built
}
