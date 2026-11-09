import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

const WIDTHS = {full: 'max-w-none', reading: 'max-w-3xl', standard: 'max-w-6xl', wide: 'max-w-6xl'} satisfies Record<
	Width,
	string
>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-4 sm:px-8 sm:pt-5">
			<div
				className={cn(
					'flex min-h-full w-full flex-col gap-5 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A ruled section: the label names the set, the meta counts it, and the hairline separates it from the next set.
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
					'section-head flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-2.5">
					<h2 className="tracking-label text-muted-foreground text-meta font-semibold">{props.title}</h2>
					{props.meta !== undefined && (
						<span className="text-muted-foreground text-meta font-mono tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A one-line fact for a summary strip: the label stays quiet, the value carries the weight.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex items-baseline gap-1.5 whitespace-nowrap">
			<span className="text-muted-foreground tracking-label text-meta font-medium">{props.label}</span>
			<span className="text-ui font-mono leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
