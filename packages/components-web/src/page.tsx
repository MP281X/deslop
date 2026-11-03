import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

// DESIGN.md's one column under the app bar, at least the page's height so a lone state that grows sits in its middle.
export function Page(props: {children: ReactNode; className?: string}) {
	return (
		<main className="pb-safe flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-3">
			<div className={cn('flex min-h-full w-full max-w-3xl flex-col gap-4 self-start', props.className)}>
				{props.children}
			</div>
		</main>
	)
}
