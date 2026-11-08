import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

const WIDTHS = {full: 'max-w-none', reading: 'max-w-3xl', standard: 'max-w-6xl', wide: 'max-w-7xl'} satisfies Record<
	Width,
	string
>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
			<div
				className={cn(
					'flex min-h-full w-full flex-col gap-8 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// One serif statement names the view; the eyebrow says what kind of view it is, and the deck says what the page is for.
export function PageHeader(props: {actions?: ReactNode; description?: string; eyebrow: string; title: string}) {
	return (
		<header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
			<div className="flex min-w-0 flex-col gap-2">
				<p className="text-muted-foreground tracking-label text-xs font-semibold uppercase">{props.eyebrow}</p>
				<h1 className="font-heading text-4xl leading-none tracking-tight text-balance sm:text-5xl">{props.title}</h1>
				{props.description !== undefined && (
					<p className="text-muted-foreground max-w-prose text-sm leading-relaxed text-pretty">{props.description}</p>
				)}
			</div>
			{props.actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>}
		</header>
	)
}

// A ruled section: the label names the set, the meta counts it, and the line separates it from the next set.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	meta?: string
	title: string
}) {
	return (
		<section className={cn('flex flex-col', props.className)} aria-label={props.title}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t pt-3 pb-2">
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="tracking-label text-xs font-semibold uppercase">{props.title}</h2>
					{props.meta !== undefined && (
						<span className="text-muted-foreground font-mono text-xs tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A one-line fact for a header or a summary strip: the label stays quiet, the value carries the weight.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground tracking-label text-xs font-semibold uppercase">{props.label}</span>
			<span className="font-heading text-2xl leading-none tracking-tight tabular-nums">{props.value}</span>
		</div>
	)
}
