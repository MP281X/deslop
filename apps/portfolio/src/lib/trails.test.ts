import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {appendTrails, trailCells} from '#lib/trails.ts'
import {Visitor, VisitorId} from '#services/presence/schema.ts'

const VIEWPORT = {height: 1040, width: 2600}

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

it('paints one cell per grid step, the newest colour on top and a layer per crossing', () => {
	assert.deepStrictEqual(
		Array.map(trailCells([at('a', 0, 0), at('a', 0.04, 0, '#4385be'), at('a', 0, 0, '#4385be')], VIEWPORT), cell => [
			cell.x,
			cell.y,
			cell.color,
			cell.layers
		]),
		[
			[1, 1, '#4385be', 3],
			[27, 1, '#4385be', 2],
			[53, 1, '#4385be', 2],
			[79, 1, '#4385be', 2],
			[105, 1, '#4385be', 2]
		]
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
