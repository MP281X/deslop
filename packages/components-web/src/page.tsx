import type {ReactNode} from 'react'

import {cn} from '#lib/utils.ts'

const WIDTHS = {
	full: 'max-w-none',
	reading: 'max-w-[52rem]',
	standard: 'max-w-[72rem]',
	wide: 'max-w-[88rem]'
} satisfies Record<Width, string>

export type Width = 'full' | 'reading' | 'standard' | 'wide'

// Floating panes start 24px under the masthead, on a 24px gutter, 12px apart.
export function Page(props: {children: ReactNode; className?: string; width?: Width}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6">
			<div
				className={cn(
					'flex min-h-full w-full flex-col gap-3 self-start',
					WIDTHS[props.width ?? 'standard'],
					props.className
				)}
			>
				{props.children}
			</div>
		</main>
	)
}

// A floating glass section: the label names the set, the meta counts it, and 12px of ink separates it from the next.
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
			className={cn(
				'glass motion-safe:animate-glass-in flex min-h-0 flex-col overflow-hidden rounded-2xl',
				props.className
			)}
			aria-label={props.title}
		>
			<div
				className={cn(
					'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-4 pt-3 pb-2',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="tracking-label text-muted-foreground font-mono text-xs font-medium uppercase">
						{props.title}
					</h2>
					{props.meta !== undefined && (
						<span className="text-muted-foreground/80 font-mono text-xs tabular-nums">{props.meta}</span>
					)}
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
			</div>
			{props.children}
		</section>
	)
}

// A compact glass chip for a summary strip: the label stays quiet, the value carries the weight.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="glass inline-flex items-center gap-2 rounded-lg px-2.5 py-1">
			<span className="text-muted-foreground tracking-label text-2xs font-mono font-medium uppercase">
				{props.label}
			</span>
			<span className="font-mono text-xs leading-none tabular-nums">{props.value}</span>
		</span>
	)
}
