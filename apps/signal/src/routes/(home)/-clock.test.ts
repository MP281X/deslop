import {assert, it} from '@effect/vitest'

import {animationTime} from './-clock.ts'

it('freezes at the displayed simulation tick while paused, including historical seeks', () => {
	assert.strictEqual(animationTime(20, 400, 0, 10), 20)
	assert.strictEqual(animationTime(20, 100, 0, 10), 5)
	assert.strictEqual(animationTime(5, 4000, 0, 10), 200)
})

it('interpolates only one frame beyond a tick and never runs indefinitely after a stalled stream', () => {
	assert.closeTo(animationTime(20, 400, 1, 0.05), 20.05, 0.0001)
	assert.closeTo(animationTime(20.05, 400, 1, 10), 20.1, 0.0001)
	assert.closeTo(animationTime(20.1, 400, 1, 10), 20.1, 0.0001)
	assert.strictEqual(animationTime(20, 100, 10, 0.1), 5)
})
