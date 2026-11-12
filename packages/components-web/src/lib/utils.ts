import type {ClassValue} from 'clsx'
import {clsx} from 'clsx'
import {Atom} from 'effect/reactivity'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

// Whether the screen matches a media query, read during the first render, so a phone never paints the desktop layout first.
export const mediaQueryAtom = Atom.family((query: string) =>
	Atom.make(get => {
		const list = matchMedia(query)
		function onChange(event: MediaQueryListEvent) {
			get.setSelf(event.matches)
		}
		list.addEventListener('change', onChange)
		get.addFinalizer(() => list.removeEventListener('change', onChange))
		return list.matches
	})
)
