import {DateTime, Duration, Option} from 'effect'

import {Atom} from 'effect/reactivity'
import {AppState} from 'react-native'

// How long the app spent in the background before its latest return.
export const awayAtom = Atom.keepAlive(Atom.make(Duration.zero))

// iOS suspends sockets in the background, so atoms that read this count start over on each return from it; a sign-in sheet only makes the app inactive.
export const activationsAtom = Atom.make(get => {
	const left = {at: Option.none<DateTime.Utc>()}
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'background') {
			left.at = Option.some(DateTime.nowUnsafe())
		}
		if (state !== 'active' || Option.isNone(left.at)) return
		Option.map(left.at, at => get.set(awayAtom, DateTime.distance(at, DateTime.nowUnsafe())))
		left.at = Option.none()
		get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})
