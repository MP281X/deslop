import type {ClassValue} from 'clsx'
import {clsx} from 'clsx'
import {useSyncExternalStore} from 'react'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

// Whether the screen matches a media query, read during the first render, so a phone never paints the desktop layout first.
export function useMediaQuery(query: string) {
	return useSyncExternalStore(
		onChange => {
			const list = window.matchMedia(query)
			list.addEventListener('change', onChange)
			return () => list.removeEventListener('change', onChange)
		},
		() => window.matchMedia(query).matches,
		() => false
	)
}
