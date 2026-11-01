import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import * as THREE from 'three'

import {pickActor} from './-pick.ts'

function project(x: number, _y: number, z: number) {
	return {x, y: z}
}

it('picks only drawn actors, never an invisible actor at a default or stale position', () => {
	const hidden = new THREE.Object3D()
	hidden.visible = false
	const shown = new THREE.Object3D()
	shown.position.set(3, 0, 4)
	const actors = [
		{id: 1, object: hidden},
		{id: 2, object: shown}
	]
	assert.strictEqual(Option.getOrThrow(pickActor(actors, project, 0, 0)), 2)
	hidden.position.set(3, 0, 4)
	assert.strictEqual(Option.getOrThrow(pickActor(actors, project, 3, 4)), 2)
	shown.visible = false
	assert.isTrue(Option.isNone(pickActor(actors, project, 3, 4)))
	shown.visible = true
	assert.isTrue(Option.isNone(pickActor(actors, project, 100, 100)))
})
