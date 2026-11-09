import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

const WIDTHS = {full: 'max-w-none', reading: 'max-w-5xl', standard: 'max-w-5xl', wide: 'max-w-6xl'} satisfies Record<
	Width,
	string
>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Full-height tools use the available screen; editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="page-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-4">
			<div
				className={cn(
					'ledger flex min-h-full w-full flex-col gap-4 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A ledger section: black full-bleed strip, acid index, the set's name and count, the line under it.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	headerClassName?: string
	meta?: string
	title: string
}) {
	return (
		<section className={cn('ledger-section flex flex-col', props.className)} aria-label={props.title}>
			<div className={cn('ledger-strip sticky top-0 z-20', props.headerClassName)}>
				<h2 className="min-w-0 truncate">{props.title}</h2>
				{props.meta !== undefined && (
					<span className="terminal-label text-strip-foreground/70 shrink-0">{props.meta}</span>
				)}
				{props.actions !== undefined && <div className="ml-auto flex min-w-0 items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A compact invoice fact: 10px mono label, 12px tabular value, nothing decorative.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex items-baseline gap-2 font-mono whitespace-nowrap">
			<span className="terminal-label text-muted-foreground">{props.label}</span>
			<span className="text-foreground text-xs leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
