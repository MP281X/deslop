import {Stream, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

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
