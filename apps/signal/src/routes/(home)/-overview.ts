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

type Point = readonly [number, number, number]

function quad(
	points: readonly [Point, Point, Point, Point],
	color: THREE.Color,
	positions: MutableList.MutableList<number>,
	colors: MutableList.MutableList<number>
) {
	for (const point of [points[0], points[1], points[2], points[2], points[1], points[3]]) {
		MutableList.appendAll(positions, point)
		MutableList.appendAll(colors, [color.r, color.g, color.b])
	}
}

export function overviewChunk(world: World, cx: number, cz: number) {
	const corners = new Float32Array(CHUNK * CHUNK * 4)
	const positions = MutableList.make<number>()
	const colors = MutableList.make<number>()
	const color = new THREE.Color()
	const step = 4
	const row = CHUNK / step + 2
	const tiles = Array.makeBy(row * row, index =>
		world.terrainAt(
			cx * CHUNK + ((index % row) - 1) * step + step / 2,
			cz * CHUNK + (Math.floor(index / row) - 1) * step + step / 2
		)
	)
	for (const z of Array.range(0, CHUNK / step - 1)) {
		for (const x of Array.range(0, CHUNK / step - 1)) {
			const gx = cx * CHUNK + x * step
			const gz = cz * CHUNK + z * step
			const tile = Option.getOrThrow(Array.get(tiles, (z + 1) * row + x + 1))
			const ground = Option.getOrElse(
				Array.findFirstIndex(GROUND_BIOME, biome => biome === tile.biome),
				() => 0
			)
			color.set(GROUND_COLOR[tile.ground] ?? GROUND_COLOR[ground] ?? '#bcd59d')
			if (tile.liquid > 0) color.set('#79b6b3')
			const height = tile.level * LEVEL
			quad(
				[
					[gx, height, gz],
					[gx, height, gz + step],
					[gx + step, height, gz],
					[gx + step, height, gz + step]
				],
				color,
				positions,
				colors
			)
			for (const edge of [
				{ax: 0, az: 0, bx: step, bz: 0, dx: 0, dz: -1},
				{ax: step, az: 0, bx: step, bz: step, dx: 1, dz: 0},
				{ax: step, az: step, bx: 0, bz: step, dx: 0, dz: 1},
				{ax: 0, az: step, bx: 0, bz: 0, dx: -1, dz: 0}
			]) {
				const neighbor = Option.getOrThrow(Array.get(tiles, (z + 1 + edge.dz) * row + x + 1 + edge.dx))
				if (neighbor.level < tile.level) {
					const bottom = neighbor.level * LEVEL
					quad(
						[
							[gx + edge.ax, height, gz + edge.az],
							[gx + edge.bx, height, gz + edge.bz],
							[gx + edge.ax, bottom, gz + edge.az],
							[gx + edge.bx, bottom, gz + edge.bz]
						],
						color,
						positions,
						colors
					)
				}
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
			normals: new Float32Array(),
			positions: Float32Array.from(MutableList.toArray(positions))
		}
	} satisfies Built
}
