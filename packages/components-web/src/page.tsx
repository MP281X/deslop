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
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6 sm:px-8 lg:pt-7">
			<div
				className={cn(
					'flex min-h-full w-full flex-col gap-6 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// An instrument tray: a 2px panel, a labelled header strip with an orange tick, and the set beneath it.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	headerClassName?: string
	meta?: string
	title: string
}) {
	return (
		<section
			className={cn('panel panel-ticks flex min-h-0 flex-col overflow-hidden', props.className)}
			aria-label={props.title}
		>
			<div
				className={cn(
					'bg-surface flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-2 px-4 py-1.5',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-center gap-2.5">
					<span aria-hidden className="bg-primary h-3 w-0.5 shrink-0 rounded-xs" />
					<h2 className="stamped text-foreground">{props.title}</h2>
					{props.meta !== undefined && (
						<span className="text-muted-foreground text-stamp font-mono tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A compact instrument readout: a stamped label beside its mono figure.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="bg-surface inline-flex h-7 items-center gap-2 rounded-sm border-2 px-2.5 whitespace-nowrap">
			<span className="stamped text-muted-foreground">{props.label}</span>
			<span className="font-mono text-xs leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
