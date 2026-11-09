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
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6 sm:px-8 lg:pt-8">
			<div
				className={cn(
					'page-columns w-full gap-x-8 gap-y-6 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A section header is three columns: its red index, the 20px title, then the meta and actions at the right rule.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	figure?: ReactNode
	headerClassName?: string
	meta?: string
	title: string
}) {
	return (
		<section className={cn('flex flex-col', props.className)} aria-label={props.title}>
			<div className={cn('grid-section grid items-baseline gap-x-4 gap-y-2 border-t pt-3 pb-2', props.headerClassName)}>
				<span aria-hidden="true" className="section-number self-baseline" />
				<h2 className="tracking-strong text-xl leading-none font-semibold">{props.title}</h2>
				<div className="flex items-baseline justify-end gap-4">
					{props.figure}
					{props.meta !== undefined && (
						<span className="text-muted-foreground text-label tracking-label font-mono uppercase">{props.meta}</span>
					)}
					{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
				</div>
			</div>
			{props.children}
		</section>
	)
}

// A one-line fact for a summary strip: the label stays quiet, the value carries the weight.
export function Stat(props: {label: string; large?: boolean; value: ReactNode}) {
	return (
		<span className="flex flex-col gap-1 whitespace-nowrap">
			<span className="text-muted-foreground text-label tracking-label font-mono uppercase">{props.label}</span>
			<span
				className={cn(
					'font-mono leading-none tabular-nums',
					props.large === true && 'text-figure-sm tracking-display sm:text-figure',
					props.large !== true && 'text-2xl'
				)}
			>
				{props.value}
			</span>
		</span>
	)
}
