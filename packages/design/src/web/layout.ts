import {Mount} from '@effect/ui'

import {Effect, Queue, Stream} from 'effect'

import {resized} from '../shared/model.ts'

export const WatchLayout = Mount.makeStream('WatchDesignLayout', {args: {}}, (node: HTMLElement) =>
	Stream.callback<ReturnType<typeof resized>>(out =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const observer = new ResizeObserver(() => {
					const {width, height} = node.getBoundingClientRect()
					Queue.offerUnsafe(out, resized({width, height}))
				})
				observer.observe(node)
				return observer
			}),
			observer => Effect.sync(() => observer.disconnect())
		)
	)
)
