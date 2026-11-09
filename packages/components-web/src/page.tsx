import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

// Reading is 48rem, a tool 72rem, and the workspace keeps the viewport.
const WIDTHS = {full: 'max-w-none', reading: 'max-w-3xl', standard: 'max-w-6xl', wide: 'max-w-6xl'} satisfies Record<
	Width,
	string
>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6 sm:px-8 sm:pt-16">
			<div
				className={cn(
					'pane-rise flex min-h-full w-full flex-col gap-8 self-start motion-reduce:animate-none',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A section breathes 32px above and is named by one hairline: a mono label, its count, then air.
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
					'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b pb-2',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="type-label text-muted-foreground">{props.title}</h2>
					{props.meta !== undefined && (
						<span className="type-mono text-muted-foreground tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A figure first and its name under it: 32px mono on the page, 10px mono label beneath.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex flex-col gap-1.5 whitespace-nowrap">
			<span className="type-figure">{props.value}</span>
			<span className="type-label text-muted-foreground">{props.label}</span>
		</span>
	)
}
