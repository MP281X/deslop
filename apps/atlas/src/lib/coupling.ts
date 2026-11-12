import {Array, Boolean, Function, Number, Option, Order, Record} from 'effect'

import {areaOf} from '#lib/areas.ts'
import type {PullRequest} from '#services/changes/schema.ts'

export type Coupling = {readonly a: string; readonly b: string; readonly count: number; readonly score: number}

export type CouplingMatrix = {
	readonly areas: readonly string[]
	readonly cells: readonly Coupling[]
	readonly maxCount: number
	readonly maxScore: number
}

function areasOf(pr: PullRequest) {
	return Array.sort(Array.dedupe(Array.map(pr.files, file => areaOf(file.path))), Order.String)
}

function pairsOf(areas: readonly string[]) {
	return Array.flatMap(areas, (a, index) => Array.map(Array.drop(areas, index + 1), b => ({a, b})))
}

export function couplingOf(pullRequests: readonly PullRequest[], limit: number) {
	const counts = Record.map(
		Array.groupBy(
			Array.flatMap(pullRequests, pr => areasOf(pr)),
			Function.identity
		),
		group => Array.length(group)
	)
	const pairCounts = Record.map(
		Array.groupBy(
			Array.flatMap(pullRequests, pr => pairsOf(areasOf(pr))),
			pair => `${pair.a}\u0000${pair.b}`
		),
		group => ({...Array.headNonEmpty(group), count: Array.length(group)})
	)
	const areas = Array.map(
		Array.take(
			Array.sort(
				Record.toEntries(counts),
				Order.combine(
					Order.mapInput(Order.flip(Order.Number), (entry: [string, number]) => entry[1]),
					Order.mapInput(Order.String, (entry: [string, number]) => entry[0])
				)
			),
			Number.max(0, limit)
		),
		entry => entry[0]
	)
	function touches(area: string) {
		return Option.getOrThrow(Record.get(counts, area))
	}
	const cells = Array.sort(
		Array.flatMap(Record.values(pairCounts), pair =>
			Boolean.match(Array.contains(areas, pair.a) && Array.contains(areas, pair.b), {
				onFalse: () => [],
				onTrue: () => [
					{a: pair.a, b: pair.b, count: pair.count, score: pair.count / Number.min(touches(pair.a), touches(pair.b))}
				]
			})
		),
		Order.combine(
			Order.mapInput(Order.String, (cell: Coupling) => cell.a),
			Order.mapInput(Order.String, (cell: Coupling) => cell.b)
		)
	)
	return {
		areas,
		cells,
		maxCount: Array.reduce(cells, 0, (max, cell) => Number.max(max, cell.count)),
		maxScore: Array.reduce(cells, 0, (max, cell) => Number.max(max, cell.score))
	}
}
