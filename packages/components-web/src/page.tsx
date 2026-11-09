import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

const WIDTHS = {column: 'max-w-160', full: 'max-w-none', standard: 'max-w-6xl'} satisfies Record<Width, string>

export type Width = 'column' | 'full' | 'standard'

// A column page centres one 40rem stack of cards; a workspace takes the viewport. Editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
			<div
				className={cn(
					'flex min-h-full w-full flex-col gap-4 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex items-baseline gap-1.5 text-xs whitespace-nowrap">
			<span className="text-foreground tabular-nums">{props.value}</span>
			<span className="text-muted-foreground">{props.label}</span>
		</span>
	)
}
