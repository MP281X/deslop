import {Array, Boolean, Function, HashMap, HashSet, Number, Option, Record, Tuple, pipe} from 'effect'

import type {Color, Visitor, VisitorId, Visitors} from '#contracts'

// The trail grid's pitch in CSS pixels; a cell paints all but the 2px of grid line.
const CELL = 26

// Each pass is a translucent square over the passes before it.
const PASS_OPACITY = 0.22

// Each palette colour's channels, for blending passes; a colour added to the palette fails the type check here.
const CHANNELS: Record<Color, {blue: number; green: number; red: number}> = {
	'#3aa99f': {blue: 0x9f, green: 0xa9, red: 0x3a},
	'#8b7ec8': {blue: 0xc8, green: 0x7e, red: 0x8b},
	'#4385be': {blue: 0xbe, green: 0x85, red: 0x43},
	'#ce5d97': {blue: 0x97, green: 0x5d, red: 0xce},
	'#d0a215': {blue: 0x15, green: 0xa2, red: 0xd0},
	'#da702c': {blue: 0x2c, green: 0x70, red: 0xda}
}

// The passes over one cell, newest first, painted once as the source-over blend their stacked squares make: crossing colours mix and a repeated colour darkens.
function blend(colors: Array.NonEmptyReadonlyArray<Color>) {
	const opacity = 1 - (1 - PASS_OPACITY) ** Array.length(colors)
	const blended = Array.reduce(colors, {blue: 0, green: 0, red: 0}, (sum, color, depth) => {
		const weight = (PASS_OPACITY * (1 - PASS_OPACITY) ** depth) / opacity
		return {
			blue: sum.blue + CHANNELS[color].blue * weight,
			green: sum.green + CHANNELS[color].green * weight,
			red: sum.red + CHANNELS[color].red * weight
		}
	})
	// Thousandths of a channel are finer than any screen shows, and keep float noise out of the page.
	return {
		fill: `rgb(${Number.round(blended.red, 3)} ${Number.round(blended.green, 3)} ${Number.round(blended.blue, 3)})`,
		opacity
	}
}

// The latest 180 positions in the order cursors reached them; a recolour starts a new stretch where the cursor is.
export function appendTrails(
	trails: Visitors,
	previous: {bots: Visitors; visitors: Visitors},
	update: typeof previous
) {
	const positions = HashSet.fromIterable(
		pipe(
			previous.visitors,
			Array.appendAll(previous.bots),
			Array.map(visitor => Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
		)
	)
	const moved = pipe(
		update.visitors,
		Array.appendAll(update.bots),
		Array.filter(visitor => !HashSet.has(positions, Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y)))
	)
	return pipe(trails, Array.appendAll(moved), Array.takeRight(180))
}

// One cell per grid step between a cursor's positions, in the colour of the stretch that reached it; a cell crossed again blends every pass, as overlapping translucent squares do.
export function trailCells(trails: Visitors, viewport: {height: number; width: number}) {
	const [, segments] = Array.mapAccum(
		trails,
		HashMap.empty<VisitorId, {col: number; row: number; trail: Visitor}>(),
		(previousByVisitor, trail) => {
			const current = {
				col: Math.floor((trail.x * viewport.width) / CELL),
				row: Math.floor((trail.y * viewport.height) / CELL),
				trail
			}
			const previous = pipe(
				previousByVisitor,
				HashMap.get(trail.id),
				Option.getOrElse(() => current)
			)
			const stepCount = Number.max(Math.abs(current.col - previous.col), Math.abs(current.row - previous.row))
			const segment = Array.makeBy(stepCount + 1, step => {
				const progress = Boolean.match(stepCount === 0, {onFalse: () => step / stepCount, onTrue: Function.constant(1)})
				const col = Number.round(previous.col + (current.col - previous.col) * progress, 0)
				const row = Number.round(previous.row + (current.row - previous.row) * progress, 0)
				const color = Boolean.match(progress < 1, {
					onFalse: () => current.trail.color,
					onTrue: () => previous.trail.color
				})
				return {color, x: col * CELL + 1, y: row * CELL + 1}
			})
			return [HashMap.set(previousByVisitor, trail.id, current), segment]
		}
	)
	// 180 positions spread across a wide screen would interpolate into tens of thousands of cells; the newest 1,024 are painted.
	return pipe(
		segments,
		Array.flatten,
		Array.reverse,
		Array.groupBy(cell => `${cell.x}:${cell.y}`),
		Record.collect((key, passes) => ({
			...blend(Array.map(passes, pass => pass.color)),
			key,
			x: Array.headNonEmpty(passes).x,
			y: Array.headNonEmpty(passes).y
		})),
		Array.take(1024)
	)
}
