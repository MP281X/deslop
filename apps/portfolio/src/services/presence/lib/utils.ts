import {Array, Option, pipe} from 'effect'

import type {Visitor, Visitors} from '#services/presence/schema.ts'

// Moves under a quarter of a percent of the viewport are neither sent nor drawn.
export function hasMeaningfulMove(current: {x: number; y: number}, next: {x: number; y: number}) {
	const deltaX = next.x - current.x
	const deltaY = next.y - current.y

	return deltaX * deltaX + deltaY * deltaY >= 0.0025 * 0.0025
}

export function upsertVisitor(visitors: Visitors, visitor: Visitor) {
	return pipe(
		Array.findFirstIndex(visitors, current => current.id === visitor.id),
		Option.flatMap(index => Array.replace(visitors, index, visitor)),
		Option.getOrElse(() => Array.append(visitors, visitor))
	)
}
