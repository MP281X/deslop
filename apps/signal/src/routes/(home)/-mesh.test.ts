import {assert, it} from '@effect/vitest'

import {Array, MutableHashMap, MutableHashSet, Option} from 'effect'

import {visibleProps} from './-mesh.ts'
import type {Overlay} from './-mesh.ts'

import {makeWorld} from '#services/world/lib/utils.ts'

it('keeps render and hover scenery outside foundations without changing authoritative terrain', () => {
	const props = makeWorld(898_004_791).chunk(-3, 8).props
	const first = Option.getOrThrow(Array.head(props))
	const overlay: Overlay = {
		amounts: MutableHashMap.empty(),
		cleared: MutableHashSet.empty(),
		edits: MutableHashMap.empty(),
		sites: [{d: 1, w: 1, x: first.x - 0.5, z: first.z - 0.5}]
	}
	assert.isFalse(Array.some(visibleProps(props, overlay), prop => prop.id === first.id))
	assert.isTrue(Array.some(props, prop => prop.id === first.id))
	assert.isTrue(Array.some(visibleProps(props, {...overlay, sites: []}), prop => prop.id === first.id))
	MutableHashSet.add(overlay.cleared, first.id)
	assert.isFalse(Array.some(visibleProps(props, {...overlay, sites: []}), prop => prop.id === first.id))
})
