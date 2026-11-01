import {Boolean, Number, Option, Schema} from 'effect'

// One pending frame, no heartbeat while idle. Waking after an idle gap never advances by that gap.
export function createDrawLoop(
	draw: (delta: number) => boolean,
	frames: {request: (callback: FrameRequestCallback) => number; cancel: (id: number) => void}
) {
	const state = {closed: false, last: Option.none<number>(), pending: Option.none<number>()}
	function invalidate() {
		if (state.closed || Option.isSome(state.pending)) return
		state.pending = Option.some(
			frames.request(now => {
				state.pending = Option.none()
				if (state.closed) return
				const delta = Option.match(state.last, {
					onNone: () => 1 / 60,
					onSome: before => Number.clamp((now - before) / 1000, {maximum: 0.1, minimum: 0})
				})
				state.last = Option.some(now)
				if (draw(delta)) invalidate()
				else state.last = Option.none()
			})
		)
	}
	return {
		dispose() {
			state.closed = true
			Option.match(state.pending, {onNone: () => undefined, onSome: frames.cancel})
			state.pending = Option.none()
		},
		invalidate
	}
}

export function pixelRatio(device: number, coarse: boolean, development: boolean, search: string) {
	const normal = Number.min(device, Boolean.match(coarse, {onFalse: () => 2, onTrue: () => 1.5}))
	if (!development) return normal
	return Option.match(Number.parse(new URLSearchParams(search).get('dpr') ?? ''), {
		onNone: () => normal,
		onSome: cap => {
			if (!Schema.is(Schema.Finite)(cap) || cap <= 0) return normal
			return Number.min(normal, Number.max(0.25, cap))
		}
	})
}
