import {assert, it} from '@effect/vitest'

import {Array, MutableHashMap, MutableHashSet, Option, Record} from 'effect'

import {buildChunk} from './-mesh.ts'
import type {Overlay} from './-mesh.ts'

import {makeWorld} from '#services/world/lib/utils.ts'

it('builds scenery outside foundations without changing authoritative terrain', () => {
	const world = makeWorld(898_004_791)
	const props = world.chunk(-3, 8).props
	const first = Option.getOrThrow(Array.head(props))
	const chunks = Record.fromEntries(
		Array.flatMap(Array.range(-4, -2), cx =>
			Array.map(
				Array.range(7, 9),
				cz =>
					[
						`${cx},${cz}`,
						{...world.chunk(cx, cz), props: Array.filter(world.chunk(cx, cz).props, prop => prop.id === first.id)}
					] as const
			)
		)
	)
	function chunkAt(cx: number, cz: number) {
		return Option.getOrThrow(Record.get(chunks, `${cx},${cz}`))
	}
	const overlay: Overlay = {
		amounts: MutableHashMap.empty(),
		cleared: MutableHashSet.empty(),
		edits: MutableHashMap.empty(),
		sites: [{d: 1, w: 1, x: first.x - 0.5, z: first.z - 0.5}]
	}
	const foundation = buildChunk(chunkAt, overlay, -3, 8)
	assert.isAbove(
		buildChunk(chunkAt, {...overlay, sites: []}, -3, 8).props.positions.length,
		foundation.props.positions.length
	)
	assert.isTrue(Array.some(props, prop => prop.id === first.id))
	MutableHashSet.add(overlay.cleared, first.id)
	assert.deepStrictEqual(buildChunk(chunkAt, {...overlay, sites: []}, -3, 8).props, foundation.props)
})
