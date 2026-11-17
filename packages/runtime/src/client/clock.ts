import type {Duration} from 'effect'
import {DateTime, Stream} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'

// Seed at each mount, not module load; subscribers share a timer and disposal stops it.
export const clockAtom = Atom.family((every: Duration.Input) => {
	const ticksAtom = Atom.make(Stream.mapEffect(Stream.tick(every), () => DateTime.now))
	return Atom.make(get => {
		get.subscribe(ticksAtom, result => {
			if (AsyncResult.isSuccess(result)) get.setSelf(result.value)
		})
		return DateTime.nowUnsafe()
	})
})
