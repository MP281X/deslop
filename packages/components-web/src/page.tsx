import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

// A console workspace fills the viewport; a reading page keeps the 56rem column the terminal ledger needs.
const WIDTHS = {full: 'max-w-none', reading: 'max-w-4xl', standard: 'max-w-4xl', wide: 'max-w-6xl'} satisfies Record<
	Width,
	string
>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-3">
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

// A console section: a 10px ruled label, its count, and the actions that belong to the set.
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
					'flex h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-1.5',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-2">
					<h2 className="tracking-label text-2xs font-mono font-medium uppercase">{props.title}</h2>
					{props.meta !== undefined && (
						<span className="text-muted-foreground text-2xs font-mono tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A compact console fact: a 10px label over a 12px mono value, never a hero figure.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex items-baseline gap-1.5 whitespace-nowrap">
			<span className="text-muted-foreground tracking-label text-2xs font-mono uppercase">{props.label}</span>
			<span className="font-mono text-xs leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
