import {Array, Option, pipe} from 'effect'

import type {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

// Moves under a quarter of a percent of the viewport are neither sent nor drawn.
export function hasMeaningfulMove(current: {x: number; y: number}, next: {x: number; y: number}) {
	const deltaX = next.x - current.x
	const deltaY = next.y - current.y

	return deltaX * deltaX + deltaY * deltaY >= 0.0025 * 0.0025
}

export function removePortfolioVisitor(visitors: PortfolioVisitors, id: string) {
	const next = Array.filter(visitors, visitor => visitor.id !== id)
	if (Array.length(next) === Array.length(visitors)) return visitors
	return next
}

export function upsertPortfolioVisitor(visitors: PortfolioVisitors, visitor: PortfolioVisitor) {
	return pipe(
		Array.findFirstIndex(visitors, current => current.id === visitor.id),
		Option.flatMap(index => Array.replace(visitors, index, visitor)),
		Option.getOrElse(() => Array.append(visitors, visitor))
	)
}
