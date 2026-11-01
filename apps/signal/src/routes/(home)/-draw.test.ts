import {assert, it} from '@effect/vitest'

import {Array, MutableHashMap, Option} from 'effect'

import * as THREE from 'three'

import {animationTime} from './-clock.ts'
import {createDrawLoop, pixelRatio} from './-draw.ts'
import {seatPose} from './-pose.ts'

function queuedFrames() {
	const callbacks = MutableHashMap.empty<number, FrameRequestCallback>()
	const state = {id: 0}
	return {
		cancel(id: number) {
			MutableHashMap.remove(callbacks, id)
		},
		pending() {
			return MutableHashMap.size(callbacks)
		},
		request(callback: FrameRequestCallback) {
			state.id += 1
			MutableHashMap.set(callbacks, state.id, callback)
			return state.id
		},
		run(now: number) {
			const pending = Array.fromIterable(MutableHashMap.values(callbacks))
			MutableHashMap.clear(callbacks)
			for (const callback of pending) callback(now)
		}
	}
}

it('coalesces invalidations, drains glides, and sleeps until another real change', () => {
	const frames = queuedFrames()
	const state = {draws: 0, moving: true}
	const loop = createDrawLoop(() => {
		state.draws += 1
		return state.moving
	}, frames)
	loop.invalidate()
	loop.invalidate()
	assert.strictEqual(frames.pending(), 1)
	frames.run(0)
	assert.strictEqual(frames.pending(), 1)
	state.moving = false
	frames.run(16)
	assert.strictEqual(frames.pending(), 0)
	frames.run(10_000)
	assert.strictEqual(state.draws, 2)
	loop.invalidate()
	frames.run(20_000)
	assert.strictEqual(state.draws, 3)
	assert.strictEqual(frames.pending(), 0)
	loop.dispose()
	loop.invalidate()
	assert.strictEqual(frames.pending(), 0)
})

it('does not lose an invalidation arriving inside a draw and cancels queued work on disposal', () => {
	const frames = queuedFrames()
	const state: {draws: number; change: () => void} = {change: () => undefined, draws: 0}
	const loop = createDrawLoop(() => {
		state.draws += 1
		state.change()
		return false
	}, frames)
	state.change = loop.invalidate
	loop.invalidate()
	frames.run(0)
	assert.strictEqual(frames.pending(), 1)
	loop.dispose()
	frames.run(16)
	assert.strictEqual(state.draws, 1)
	assert.strictEqual(frames.pending(), 0)
})

it('seeks a paused frame before terrain loads, wakes for late terrain, then idles without advancing simulation', () => {
	const frames = queuedFrames()
	const pose = {down: true, fallen: 0, level: false, object: new THREE.Object3D(), x: 2, yaw: 0, z: 3}
	const state = {draws: 0, ground: Option.none<number>(), seconds: 20, tick: 400}
	const loop = createDrawLoop(delta => {
		state.seconds = animationTime(state.seconds, state.tick, 0, delta)
		seatPose(pose, 0, () => Option.getOrElse(state.ground, () => 0))
		state.draws += 1
		return false
	}, frames)
	loop.invalidate()
	frames.run(0)
	state.tick = 100
	loop.invalidate()
	frames.run(16)
	assert.strictEqual(state.seconds, 5)
	assert.strictEqual(pose.object.position.y, 0)
	assert.strictEqual(frames.pending(), 0)
	state.ground = Option.some(7)
	loop.invalidate()
	frames.run(3_600_000)
	assert.strictEqual(state.seconds, 5)
	assert.deepStrictEqual(pose.object.position.toArray(), [2, 7, 3])
	assert.closeTo(pose.object.rotation.z, 1.2, 0.00001)
	assert.strictEqual(state.draws, 3)
	assert.strictEqual(frames.pending(), 0)
	loop.dispose()
})

it('caps development capture DPR without letting a query change production rendering', () => {
	for (const value of ['0.5', '1', '0', '-1', 'bad', 'Infinity']) {
		assert.strictEqual(pixelRatio(3, false, false, `?dpr=${value}`), 2)
	}
	assert.strictEqual(pixelRatio(2, false, true, '?dpr=0.5'), 0.5)
	assert.strictEqual(pixelRatio(1, false, true, '?dpr=3'), 1)
	assert.strictEqual(pixelRatio(3, true, true, '?dpr=3'), 1.5)
	assert.strictEqual(pixelRatio(2, false, true, '?dpr=0.01'), 0.25)
	for (const value of ['0', '-1', 'bad', 'Infinity']) assert.strictEqual(pixelRatio(2, false, true, `?dpr=${value}`), 2)
})
