import {Boolean} from 'effect'

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
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-6 sm:px-8 lg:pt-8">
			<div
				className={cn(
					'page-rules min-h-full w-full gap-y-8 self-start',
					Boolean.match(props.width === 'full', {onFalse: () => 'page-grid', onTrue: () => 'flex flex-col'}),
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A counted section: a mono index, an uppercase block title and a 2px rule, then its rows.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	headerClassName?: string
	index?: string
	meta?: string
	title: string
}) {
	return (
		<section className={cn('flex flex-col', props.className)} aria-label={props.title}>
			<div
				className={cn(
					'bg-background border-rule-strong flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b-2 pt-1 pb-2',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-3">
					{props.index !== undefined && (
						<span className="text-signal font-mono text-xs tabular-nums">{props.index}</span>
					)}
					<h2 className="tracking-block text-sm font-extrabold uppercase">{props.title}</h2>
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

// A compact stat block: a mono label ruled over its figure, one cell of the page grid.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="border-border flex min-w-28 flex-col gap-1 border-2 px-3 py-2">
			<span className="text-muted-foreground text-2xs tracking-label font-mono uppercase">{props.label}</span>
			<span className="font-mono text-xl leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
