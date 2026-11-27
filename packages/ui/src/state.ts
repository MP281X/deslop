import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Option, Stream, pipe} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

import {
	blockingFailure,
	isDeniedCause,
	keepValueThroughOutages,
	needsSignInCause,
	reconnectOnDrop
} from '@deslop/runtime/client/live-stream'

import {Notice} from './axis.ts'

export function observe<A, M>(atom: Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(
		AtomRegistry.AtomRegistry.useSync(registry => pipe(registry, AtomRegistry.toStream(atom), Stream.map(read)))
	)
}

export function refreshFailed<A, E>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) {
	if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
}

export function foldLiveList<A, Event, E, R>(
	events: Stream.Stream<Event, E, R>,
	seed: () => A,
	reduce: (previous: A, event: Event) => A
) {
	return pipe(events, Stream.scan(seed, reduce), Stream.drop(1))
}

export function liveList<A, Event, E, R>(
	get: Atom.AtomContext,
	events: Stream.Stream<Event, E, R>,
	seed: () => A,
	reduce: (previous: A, event: Event) => A
) {
	return keepValueThroughOutages(get, foldLiveList(events, seed, reduce), reconnectOnDrop)
}

export function ReadCombined<A, E, M>(options: {
	failure: Option.Option<Cause.Cause<E>>
	value: Option.Option<A>
	loading: () => View.Input<M>
	failed: (reason: Cause.Cause<E>) => View.Input<M>
	ready: (value: A) => View.Input<M>
}) {
	return Option.match(options.failure, {
		onNone: () => Option.match(options.value, {onNone: options.loading, onSome: options.ready}),
		onSome: options.failed
	})
}

export function ReadState<A, E, M>(
	result: AsyncResult.AsyncResult<A, E>,
	options: {
		loading: () => View.Input<M>
		failed: (reason: Cause.Cause<E>) => View.Input<M>
		ready: (value: A, stale: boolean) => View.Input<M>
	}
) {
	return ReadCombined({
		...options,
		failure: blockingFailure(result),
		ready: value => options.ready(value, AsyncResult.isFailure(result)),
		value: AsyncResult.value(result)
	})
}

export function ReadFailure<M>(h: Html.H<M>, cause: Cause.Cause<unknown>, text: string, retry: M) {
	if (needsSignInCause(cause)) return Notice(h, 'Signing in…')
	if (isDeniedCause(cause)) return Notice(h, 'Access denied')
	return Notice(h, text, retry)
}
