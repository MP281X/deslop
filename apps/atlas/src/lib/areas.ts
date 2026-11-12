import {Array, Option, Order, Record, String} from 'effect'

import type {FileChange} from '#services/changes/schema.ts'

const ROOTS = ['apps', 'libs', 'modules', 'packages', 'projects', 'services', 'tools']

export function areaOf(path: string) {
	const segments = String.split(path, '/')
	if (!String.includes('/')(path)) return '(root)'
	const root = segments[0]
	const second = Option.getOrUndefined(Option.filter(Array.get(segments, 1), String.isNonEmpty))
	if (Array.contains(ROOTS, root) && second !== undefined) return `${root}/${second}`
	return root
}

export type AreaChurn = {
	readonly additions: number
	readonly area: string
	readonly deletions: number
	readonly files: number
}

export function churnByArea(files: readonly FileChange[]) {
	return Array.sort(
		Record.values(
			Record.map(
				Array.groupBy(files, file => areaOf(file.path)),
				(group, area) => ({
					additions: Array.reduce(group, 0, (total, file) => total + file.additions),
					area,
					deletions: Array.reduce(group, 0, (total, file) => total + file.deletions),
					files: Array.length(group)
				})
			)
		),
		Order.combine(
			Order.mapInput(Order.flip(Order.Number), (row: AreaChurn) => row.additions + row.deletions),
			Order.mapInput(Order.String, (row: AreaChurn) => row.area)
		)
	)
}
