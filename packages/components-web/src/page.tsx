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

// A ruled section: the title names the set, the meta counts it, and the line separates it from the next set.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	headerClassName?: string
	meta?: string
	title: string
}) {
	return (
		<section className={cn('flex flex-col', props.className)} aria-label={props.title}>
			<div
				className={cn(
					'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3 pb-2',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="font-heading text-sm font-medium">{props.title}</h2>
					{props.meta !== undefined && <span className="text-muted-foreground text-xs tabular-nums">{props.meta}</span>}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
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
