import {Boolean, Number} from 'effect'

import type * as THREE from 'three'

export function spatialBlend(delta: number, rate: number) {
	if (delta === 0) return 1
	return 1 - Math.exp(-delta * rate)
}

// Authoritative poses still settle when time is stopped, including terrain arriving after the frame.
export function seatPose(
	pose: {object: THREE.Object3D; x: number; z: number; yaw: number; fallen: number; down: boolean; level: boolean},
	delta: number,
	height: (x: number, z: number) => number
) {
	const ahead = {x: Math.sin(pose.yaw) * 0.3, z: Math.cos(pose.yaw) * 0.3}
	const pitch = Math.atan2(height(pose.x - ahead.x, pose.z - ahead.z) - height(pose.x + ahead.x, pose.z + ahead.z), 0.6)
	const roll = Math.atan2(height(pose.x + ahead.z, pose.z - ahead.x) - height(pose.x - ahead.z, pose.z + ahead.x), 0.6)
	const fallen = Boolean.match(delta === 0, {
		onFalse: () =>
			Number.clamp(pose.fallen + Boolean.match(pose.down, {onFalse: () => -1, onTrue: () => 1}) * delta * 3, {
				maximum: 1,
				minimum: 0
			}),
		onTrue: () => Boolean.match(pose.down, {onFalse: () => 0, onTrue: () => 1})
	})
	pose.object.position.set(
		pose.x,
		pose.object.position.y + (height(pose.x, pose.z) - pose.object.position.y) * spatialBlend(delta, 12),
		pose.z
	)
	pose.object.rotation.set(0, 0, 0)
	pose.object.rotateY(pose.yaw)
	if (!pose.level) {
		pose.object.rotateX(pitch * 0.8)
		pose.object.rotateZ(roll * 0.8 + fallen * 1.2)
	}
	return fallen
}
