import {Mount} from '@effect/ui'

import {Effect, Predicate, Queue, Schema, Stream} from 'effect'

import {resized, restored} from '../shared/model.ts'

function opened(state: unknown) {
	if (!Predicate.hasProperty(state, 'designItem') || !Predicate.isString(state.designItem)) return undefined
	return state.designItem
}

export const WatchLayout = Mount.makeStream(
	'WatchDesignLayout',
	{args: {id: Schema.UndefinedOr(Schema.String)}},
	(node: HTMLElement, _, changes) =>
		Stream.callback<ReturnType<typeof resized> | ReturnType<typeof restored>>(out =>
			Effect.gen(function* () {
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						const pop = () => Queue.offerUnsafe(out, restored({id: opened(history.state)}))
						const observer = new ResizeObserver(() => {
							const {width, height} = node.getBoundingClientRect()
							Queue.offerUnsafe(out, resized({width, height}))
						})
						observer.observe(node)
						window.addEventListener('popstate', pop)
						pop()
						return {observer, pop}
					}),
					({observer, pop}) =>
						Effect.sync(() => {
							observer.disconnect()
							window.removeEventListener('popstate', pop)
						})
				)
				yield* Stream.runForEach(Stream.drop(changes, 1), ({id}) =>
					Effect.sync(() => {
						const previous = opened(history.state)
						if (previous === id) return
						const state: unknown = history.state
						const entry = {...(Predicate.isObject(state) ? state : {}), designItem: id}
						if (previous === undefined) history.pushState(entry, '')
						else history.replaceState(entry, '')
					})
				)
			})
		)
)
