import {Array, Boolean, Function, HashMap, HashSet, Number, Option, Record, Tuple, pipe} from 'effect'

import type {Visitor, VisitorId, Visitors} from '#services/presence/schema.ts'

// The trail grid's pitch in CSS pixels; a cell paints all but the 2px of grid line.
const CELL = 26

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

// One cell per grid step between a cursor's positions, in the newest stretch's colour; a cell crossed again paints a further layer, as overlapping translucent squares do.
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
		Record.collect((key, layers) => ({...Array.headNonEmpty(layers), key, layers: Array.length(layers)})),
		Array.take(1024)
	)
}
