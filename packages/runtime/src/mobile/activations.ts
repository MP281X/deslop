import {DateTime, Option} from 'effect'

import {Atom} from 'effect/reactivity'
import {AppState} from 'react-native'

// How long the app spent in the background before its latest return, in milliseconds.
export const awayAtom = Atom.keepAlive(Atom.make(0))

// iOS suspends sockets in the background, so atoms that read this count start over on each return from it; a sign-in sheet only makes the app inactive.
export const activationsAtom = Atom.make(get => {
	const left = {at: 0, background: false}
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'background') {
			left.at = DateTime.toEpochMillis(DateTime.nowUnsafe())
			left.background = true
		}
		if (state !== 'active' || !left.background) return
		left.background = false
		get.set(awayAtom, DateTime.toEpochMillis(DateTime.nowUnsafe()) - left.at)
		get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})
