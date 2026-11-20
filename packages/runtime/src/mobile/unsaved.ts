import {Atom} from 'effect/reactivity'

// How many mounted screens hold typed text nobody saved; the updater reads it before a reload.
export const unsavedAtom = Atom.keepAlive(Atom.make(0))

// A screen's claim on the updater: mount the returned atom with `useAtomMount` and the screen counts as unsaved while `held` is true.
export function unsaved(held: Atom.Atom<boolean>) {
	return Atom.make(get => {
		if (!get(held)) return
		// A finalizer's own context is already closed, so both sides write through the registry.
		get.registry.set(unsavedAtom, get.registry.get(unsavedAtom) + 1)
		get.addFinalizer(() => get.registry.set(unsavedAtom, get.registry.get(unsavedAtom) - 1))
	})
}
