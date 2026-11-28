import {Mount} from '@effect/ui'

import {Effect, Queue, Stream} from 'effect'

import {resized} from '#src/shared/model.ts'

export const WatchLayout = Mount.makeStream('WatchDesignLayout', {args: {}}, (node: unknown) =>
	Stream.callback<ReturnType<typeof resized>>(out =>
		Effect.acquireRelease(
			Effect.sync(() => {
				if (!(node instanceof HTMLElement)) throw new TypeError('The design layout mount needs an HTML element')
				const observer = new ResizeObserver(() => {
					const bounds = node.getBoundingClientRect()
					Queue.offerUnsafe(out, resized({height: bounds.height, width: bounds.width}))
				})
				observer.observe(node)
				return observer
			}),
			observer => Effect.sync(() => observer.disconnect())
		)
	)
)
