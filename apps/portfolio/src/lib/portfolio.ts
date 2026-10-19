import {Array, Option, pipe} from 'effect'

import type {PortfolioState, PortfolioTrail, PortfolioVisitor} from '#services/presence/schema.ts'

export const portfolioPalette = [
	'oklch(0.74 0.19 118)',
	'oklch(0.76 0.2 128)',
	'oklch(0.75 0.18 138)',
	'oklch(0.73 0.17 150)',
	'oklch(0.74 0.18 162)',
	'oklch(0.76 0.17 174)',
	'oklch(0.75 0.18 186)',
	'oklch(0.73 0.19 198)',
	'oklch(0.72 0.2 210)',
	'oklch(0.74 0.18 222)',
	'oklch(0.71 0.18 234)',
	'oklch(0.73 0.19 246)',
	'oklch(0.75 0.19 258)',
	'oklch(0.74 0.2 270)',
	'oklch(0.73 0.21 282)',
	'oklch(0.74 0.2 296)',
	'oklch(0.75 0.19 310)',
	'oklch(0.74 0.18 324)',
	'oklch(0.73 0.19 338)',
	'oklch(0.72 0.2 352)'
] as const

export function appendPortfolioTrail(trails: PortfolioState['trails'], trail: PortfolioTrail) {
	return Array.takeRight(Array.append(trails, trail), 180)
}

export function removePortfolioVisitor(visitors: PortfolioState['visitors'], id: string) {
	const next = Array.filter(visitors, visitor => visitor.id !== id)
	if (Array.length(next) === Array.length(visitors)) return visitors
	return next
}

export function upsertPortfolioVisitor(visitors: PortfolioState['visitors'], visitor: PortfolioVisitor) {
	return pipe(
		Array.findFirstIndex(visitors, current => current.id === visitor.id),
		Option.flatMap(index => Array.replace(visitors, index, visitor)),
		Option.getOrElse(() => Array.append(visitors, visitor))
	)
}
