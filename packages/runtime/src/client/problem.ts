import type {DateTime} from 'effect'
import {Option} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'

import {clockAtom} from '#client/clock.ts'

// Track the reader, so remounting its problem indicator does not reset the age.
export const problemSinceAtom = Atom.family((source: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>) =>
	Atom.make(get => {
		if (!AsyncResult.isFailure(get(source))) return Option.none<DateTime.Utc>()
		return Option.orElse(Option.flatten(get.self<Option.Option<DateTime.Utc>>()), () =>
			Option.some(get.once(clockAtom('1 second')))
		)
	})
)
