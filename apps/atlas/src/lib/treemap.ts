import {Array, Boolean, Number, Option, Order} from 'effect'

export type TreemapItem = {readonly key: string; readonly value: number}

type TreemapTile = TreemapItem & {
	readonly height: number
	readonly width: number
	readonly x: number
	readonly y: number
}

type Rect = {readonly h: number; readonly w: number; readonly x: number; readonly y: number}

function totalOf(entries: readonly TreemapItem[], scale: number) {
	return Array.reduce(entries, 0, (total, entry) => total + entry.value * scale)
}

function worstRatio(entries: readonly TreemapItem[], side: number, scale: number) {
	const total = totalOf(entries, scale)
	const largest = Array.reduce(entries, 0, (value, entry) => Number.max(value, entry.value * scale))
	return Number.max(
		(side * side * largest) / (total * total),
		(total * total) /
			(side * side * Array.reduce(entries, largest, (value, entry) => Number.min(value, entry.value * scale)))
	)
}

function rowOf(entries: readonly TreemapItem[], side: number, scale: number) {
	function grow(
		row: readonly TreemapItem[],
		rest: readonly TreemapItem[]
	): {readonly rest: readonly TreemapItem[]; readonly row: readonly TreemapItem[]} {
		return Option.match(Array.head(rest), {
			onNone: () => ({rest, row}),
			onSome: next =>
				Boolean.match(worstRatio(Array.append(row, next), side, scale) <= worstRatio(row, side, scale), {
					onFalse: () => ({rest, row}),
					onTrue: () => grow(Array.append(row, next), Array.drop(rest, 1))
				})
		})
	}
	return grow(Array.take(entries, 1), Array.drop(entries, 1))
}

function placeRow(row: readonly TreemapItem[], rect: Rect, scale: number) {
	if (rect.w >= rect.h) {
		const column = Number.min(totalOf(row, scale) / rect.h, rect.w)
		const [, tiles] = Array.mapAccum(row, rect.y, (top, entry) => {
			const height = Number.max(0, Number.min((entry.value * scale) / column, rect.y + rect.h - top))
			return [
				top + height,
				{height, key: entry.key, value: entry.value, width: column, x: rect.x, y: Number.min(top, rect.y + rect.h)}
			] as const
		})
		return {rest: {h: rect.h, w: Number.max(0, rect.w - column), x: rect.x + column, y: rect.y}, tiles}
	}
	const band = Number.min(totalOf(row, scale) / rect.w, rect.h)
	const [, tiles] = Array.mapAccum(row, rect.x, (left, entry) => {
		const width = Number.max(0, Number.min((entry.value * scale) / band, rect.x + rect.w - left))
		return [
			left + width,
			{height: band, key: entry.key, value: entry.value, width, x: Number.min(left, rect.x + rect.w), y: rect.y}
		] as const
	})
	return {rest: {h: Number.max(0, rect.h - band), w: rect.w, x: rect.x, y: rect.y + band}, tiles}
}

function layout(entries: readonly TreemapItem[], rect: Rect, scale: number): readonly TreemapTile[] {
	if (rect.w <= 0 || rect.h <= 0) return []
	if (Array.isReadonlyArrayEmpty(entries)) return []
	const placed = rowOf(entries, Number.min(rect.w, rect.h), scale)
	const placement = placeRow(placed.row, rect, scale)
	return [...placement.tiles, ...layout(placed.rest, placement.rest, scale)]
}

export function squarify(items: readonly TreemapItem[], width: number, height: number) {
	if (width <= 0 || height <= 0) return []
	const positive = Array.filter(items, item => item.value > 0)
	if (Array.isReadonlyArrayEmpty(positive)) return []
	return layout(
		Array.sort(
			positive,
			Order.mapInput(Order.flip(Order.Number), (item: TreemapItem) => item.value)
		),
		{h: height, w: width, x: 0, y: 0},
		(width * height) / Array.reduce(positive, 0, (sum, item) => sum + item.value)
	)
}
