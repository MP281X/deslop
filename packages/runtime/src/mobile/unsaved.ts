import {Atom} from 'effect/reactivity'

// How many mounted screens hold typed text nobody saved; the updater reads it before a reload.
export const unsavedAtom = Atom.keepAlive(Atom.make(0))
