import {Array, Boolean, Number} from 'effect'

const PLATE_W = 200
const PLATE_D = 150
const PLATE_T = 6
const BASE_Z = 6
const BASE_TOP = 10
const POST = 7
const SIGNS = [-1, 1]

const COS30 = Math.cos(Math.PI / 6)

export type Space = {x: number; y: number; z: number}
export type Box = {d: number; h: number; w: number; x: number; y: number; z: number}
export type Shade = 'top' | 'right' | 'left'
export type Tone = 'base' | 'paper' | 'post'
export type Part = {box: Box; plate?: number; screws: Space[]; tone: Tone}

type Corner = {sx: number; sy: number}

const CORNERS: Corner[] = Array.flatMap(SIGNS, sx => Array.map(SIGNS, sy => ({sx, sy})))

function isBack(corner: Corner) {
	return corner.sx + corner.sy <= 0
}

export function project(point: Space) {
	return {x: (point.x - point.y) * COS30, y: (point.x + point.y) / 2 - point.z}
}

function cornerOf(box: Box, dx: number, dy: number, dz: number) {
	return {x: box.x + dx * box.w, y: box.y + dy * box.d, z: box.z + dz * box.h}
}

function polygonOf(points: Space[]) {
	return Array.join(
		Array.map(points, point => {
			const screen = project(point)
			return `${screen.x.toFixed(2)},${screen.y.toFixed(2)}`
		}),
		' '
	)
}

export function visibleFaces(box: Box) {
	return [
		{
			points: polygonOf([
				cornerOf(box, 0, 0, 1),
				cornerOf(box, 1, 0, 1),
				cornerOf(box, 1, 1, 1),
				cornerOf(box, 0, 1, 1)
			]),
			shade: 'top' as const
		},
		{
			points: polygonOf([
				cornerOf(box, 1, 0, 0),
				cornerOf(box, 1, 1, 0),
				cornerOf(box, 1, 1, 1),
				cornerOf(box, 1, 0, 1)
			]),
			shade: 'right' as const
		},
		{
			points: polygonOf([
				cornerOf(box, 0, 1, 0),
				cornerOf(box, 1, 1, 0),
				cornerOf(box, 1, 1, 1),
				cornerOf(box, 0, 1, 1)
			]),
			shade: 'left' as const
		}
	]
}

// Exploded gap is 46 px between plates, assembled gap 4 px.
export function gapAt(assembly: number) {
	return 46 + (4 - 46) * assembly
}

export function assemblyAt(scrollTop: number, viewportHeight: number) {
	return Number.clamp({maximum: 1, minimum: 0})(scrollTop / (viewportHeight * 0.5))
}

function footOf(corner: Corner) {
	return {
		box: {d: 10, h: BASE_Z, w: 10, x: corner.sx * (PLATE_W / 2 + 6) - 5, y: corner.sy * (PLATE_D / 2 + 6) - 5, z: 0},
		screws: [],
		tone: 'base' as const
	}
}

// The post segment in the gap below plate `index`: it stops at the plate's underside, so the plate hides it.
function segmentOf(corner: Corner, index: number, gap: number) {
	const plateZ = BASE_TOP + index * (PLATE_T + gap)
	const bottom = Boolean.match(index === 0, {onFalse: () => plateZ - gap, onTrue: () => BASE_TOP})
	return {
		box: {
			d: POST,
			h: plateZ - bottom,
			w: POST,
			x: corner.sx * (PLATE_W / 2 - 12) - POST / 2,
			y: corner.sy * (PLATE_D / 2 - 12) - POST / 2,
			z: bottom
		},
		screws: [],
		tone: 'post' as const
	}
}

function plateOf(index: number, gap: number) {
	const z = BASE_TOP + index * (PLATE_T + gap)
	return {
		box: {d: PLATE_D, h: PLATE_T, w: PLATE_W, x: -PLATE_W / 2, y: -PLATE_D / 2, z},
		plate: index,
		screws: Array.map(CORNERS, corner => ({x: corner.sx * 60, y: corner.sy * 60, z: z + PLATE_T})),
		tone: 'paper' as const
	}
}

// Painter order: feet and base, then per plate bottom to top: the back post segments of the gap below it, the plate, and the front post segments of that gap.
export function stackOf(gap: number) {
	const base: Part = {
		box: {
			d: PLATE_D + 28,
			h: BASE_TOP - BASE_Z,
			w: PLATE_W + 28,
			x: -PLATE_W / 2 - 14,
			y: -PLATE_D / 2 - 14,
			z: BASE_Z
		},
		screws: [],
		tone: 'base'
	}

	return [
		...Array.map(CORNERS, footOf),
		base,
		...Array.flatMap(
			Array.makeBy(6, index => index),
			index => [
				...Array.map(Array.filter(CORNERS, isBack), corner => segmentOf(corner, index, gap)),
				plateOf(index, gap),
				...Array.map(
					Array.filter(CORNERS, corner => !isBack(corner)),
					corner => segmentOf(corner, index, gap)
				)
			]
		)
	] satisfies Part[]
}

// Fixed view over the exploded stack, so the figure never rescales while it assembles.
export function viewOf(parts: Part[], pad: number) {
	const points = Array.flatMap(parts, part =>
		Array.flatMap([0, 1], dx =>
			Array.flatMap([0, 1], dy => Array.map([0, 1], dz => project(cornerOf(part.box, dx, dy, dz))))
		)
	)
	const xs = Array.map(points, point => point.x)
	const ys = Array.map(points, point => point.y)
	const minX = Array.reduce(xs, Infinity, (acc, value) => Number.min(acc, value))
	const maxX = Array.reduce(xs, -Infinity, (acc, value) => Number.max(acc, value))
	const minY = Array.reduce(ys, Infinity, (acc, value) => Number.min(acc, value))

	return {
		height: Array.reduce(ys, -Infinity, (acc, value) => Number.max(acc, value)) - minY + pad * 2,
		width: maxX - minX + pad * 2,
		x: minX - pad,
		y: minY - pad
	}
}
