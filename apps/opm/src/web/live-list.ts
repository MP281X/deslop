import {Stream, pipe} from 'effect'

import type {Atom} from 'effect/reactivity'

import {keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'

export function liveList<A, Event, E, R>(
	get: Atom.AtomContext,
	events: Stream.Stream<Event, E, R>,
	seed: () => A,
	reduce: (previous: A, event: Event) => A
) {
	return keepValueThroughOutages(get, pipe(events, Stream.scan(seed, reduce), Stream.drop(1)), reconnectOnDrop)
}
