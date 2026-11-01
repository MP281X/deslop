import {assert, it} from '@effect/vitest'

import * as THREE from 'three'

import {seatPose, spatialBlend} from './-pose.ts'

it('seats a paused actor on late terrain and applies its stopped death pose without advancing time', () => {
	const pose = {down: false, fallen: 0, level: false, object: new THREE.Object3D(), x: 2, yaw: 0, z: 3}
	seatPose(pose, 0, () => 0)
	assert.strictEqual(pose.object.position.y, 0)
	assert.strictEqual(
		seatPose(pose, 0, () => 7),
		0
	)
	assert.deepStrictEqual(pose.object.position.toArray(), [2, 7, 3])
	assert.strictEqual(
		seatPose({...pose, down: true}, 0, () => 7),
		1
	)
	assert.closeTo(pose.object.rotation.z, 1.2, 0.00001)
	pose.object.updateMatrix()
	const stopped = pose.object.matrix.clone()
	seatPose({...pose, down: true}, 0, () => 7)
	pose.object.updateMatrix()
	assert.deepStrictEqual(pose.object.matrix, stopped)
	assert.strictEqual(spatialBlend(0, 10), 1)
})
