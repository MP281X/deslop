import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-3">
			<div className={cn('flex min-h-full w-full flex-col gap-4 self-start', props.className)}>{props.children}</div>
		</main>
	)
}
