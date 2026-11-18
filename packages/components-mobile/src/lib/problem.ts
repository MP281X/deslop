import {Option} from 'effect'

import {Atom} from 'effect/reactivity'
import type {AsyncResult} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {problemSinceAtom} from '@deslop/runtime/client/problem'
import {ageOf} from '@deslop/runtime/shared/format'

// A domain problem can coexist with a successful reader; only that case starts its age at display.
export const problemAgeAtom = Atom.family((source: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>) => {
	const openedAtom = Atom.make(get => get.once(clockAtom('1 minute')))
	return Atom.make(get =>
		ageOf(
			Option.getOrElse(get(problemSinceAtom(source)), () => get(openedAtom)),
			get(clockAtom('1 minute'))
		)
	)
})
