import {assert, it} from '@effect/vitest'

import {Array, Number, Option, String, pipe} from 'effect'

import {Visitor, VisitorId} from '#contracts'

import {appendTrails, trailCells} from '#web/presence/trails.ts'

const VIEWPORT = {height: 1040, width: 2600}
const ORANGE = [0xda, 0x70, 0x2c] as const
const BLUE = [0x43, 0x85, 0xbe] as const

function at(id: string, x: number, y: number, color: Visitor['color'] = '#da702c') {
	return Visitor.make({color, id: VisitorId.make(id), name: id, x, y})
}

it('adds only the cursors that moved or changed colour, keeping the latest 180 positions', () => {
	const previous = {bots: [at('server-alpha', 0.1, 0.1)], visitors: [at('a', 0.5, 0.5), at('b', 0.2, 0.2)]}
	const update = {bots: [at('server-alpha', 0.1, 0.1)], visitors: [at('a', 0.6, 0.5), at('b', 0.2, 0.2, '#4385be')]}
	assert.deepStrictEqual(appendTrails([], previous, update), [at('a', 0.6, 0.5), at('b', 0.2, 0.2, '#4385be')])
	assert.strictEqual(
		Array.length(
			appendTrails(
				Array.makeBy(180, index => at('a', index / 1000, 0)),
				previous,
				update
			)
		),
		180
	)
})

// What the page showed when every pass was its own 22% square, each painted source-over the ones before it on a white page.
function stacked(passes: readonly (readonly [number, number, number])[]) {
	return Array.map([0, 1, 2] as const, channel =>
		Array.reduce(passes, 255, (below, color) => 0.22 * color[channel] + 0.78 * below)
	)
}

// The cell's one square on the same white page.
function painted(cell: {fill: string; opacity: number}) {
	return pipe(
		cell.fill,
		String.slice(4, -1),
		String.split(' '),
		Array.map(channel => cell.opacity * Option.getOrThrow(Number.parse(channel)) + (1 - cell.opacity) * 255)
	)
}

it('paints one cell per grid step, blending every pass over it as stacked translucent squares do', () => {
	const cells = trailCells([at('a', 0, 0), at('a', 0.04, 0, '#4385be'), at('a', 0, 0, '#4385be')], VIEWPORT)
	assert.deepStrictEqual(
		Array.map(cells, cell => [cell.x, cell.y]),
		[
			[1, 1],
			[27, 1],
			[53, 1],
			[79, 1],
			[105, 1]
		]
	)
	// Oldest pass first: the first cell was crossed orange, orange, then blue; the middle ones orange then blue; the last blue twice.
	const passes = [
		[ORANGE, ORANGE, BLUE],
		[ORANGE, BLUE],
		[ORANGE, BLUE],
		[ORANGE, BLUE],
		[BLUE, BLUE]
	]
	pipe(
		cells,
		Array.zip(passes),
		Array.forEach(cell => {
			pipe(
				painted(cell[0]),
				Array.zip(stacked(cell[1])),
				Array.forEach(channel => {
					assert.closeTo(channel[0], channel[1], 1e-3)
				})
			)
		})
	)
	// A repeated colour keeps its hue and darkens with each pass.
	assert.deepStrictEqual(
		Option.map(Array.last(cells), cell => cell.opacity),
		Option.some(1 - 0.78 ** 2)
	)
})

it('paints at most the newest 1,024 cells however far the cursors travel', () => {
	// 180 full-width sweeps down a 3440×1440 screen cross about 24,000 cells; the last sweep's row comes first.
	const cells = trailCells(
		Array.makeBy(180, index => at('a', index % 2, index / 180)),
		{height: 1440, width: 3440}
	)
	assert.strictEqual(Array.length(cells), 1024)
	assert.deepStrictEqual(
		Option.map(Array.head(cells), cell => cell.y),
		Option.some(Math.floor(((179 / 180) * 1440) / 26) * 26 + 1)
	)
})
