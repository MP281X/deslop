import {Number} from 'effect'

import {FRAME_HZ, TICK_HZ} from '#services/game/lib/utils.ts'

export function animationTime(seconds: number, tick: number, speed: number, delta: number) {
	const target = tick / TICK_HZ
	if (speed === 0 || target < seconds - 1 / FRAME_HZ || target - seconds > 2) return target
	return Number.min(target + 1 / FRAME_HZ, seconds + delta * speed)
}
