import {Array} from 'effect'

import {useEffect, useState} from 'react'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger} from '#components/ui/popover.tsx'
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
		<main className="blueprint-grid bg-background pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6 sm:px-8 lg:pt-8">
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

// A measured section: sheet letter, label, count, then a dimension line across the set.
export function Section(props: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	headerClassName?: string
	meta?: string
	sheet?: string
	title: string
}) {
	return (
		<section className={cn('flex flex-col', props.className)} aria-label={props.title}>
			<div
				className={cn(
					'relative flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-2.5',
					props.headerClassName
				)}
			>
				<div className="flex min-w-0 items-end gap-3">
					{props.sheet !== undefined && (
						<span
							aria-hidden
							className="border-border bg-surface text-ring text-annotation mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs border font-mono font-semibold"
						>
							{props.sheet}
						</span>
					)}
					<div className="flex min-w-0 flex-col gap-1">
						<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<h2 className="tracking-label text-annotation font-semibold uppercase">{props.title}</h2>
							{props.meta !== undefined && (
								<span className="text-muted-foreground text-annotation font-mono tabular-nums">{props.meta}</span>
							)}
						</div>
					</div>
				</div>
				{props.actions !== undefined && <div className="flex items-center gap-2">{props.actions}</div>}
				<span aria-hidden className="dimension-line absolute inset-x-0 bottom-0" />
			</div>
			{props.children}
		</section>
	)
}

// A one-line fact for a summary strip: a dimension tick, the label, then the measured value.
export function Stat(props: {label: string; value: ReactNode}) {
	return (
		<span className="flex items-center gap-2 whitespace-nowrap">
			<span aria-hidden className="bg-ring/60 h-2 w-px shrink-0" />
			<span className="text-muted-foreground tracking-label text-annotation font-mono font-semibold uppercase">
				{props.label}
			</span>
			<span className="font-mono text-base leading-none tabular-nums">{props.value}</span>
		</span>
	)
}

// Chart and waterfall marks: a question mark opens the key; `?` does anywhere the page is not taking text.
export function Legend(props: {items: readonly {label: string; mark: ReactNode}[]; title?: string}) {
	const [open, setOpen] = useState(false)
	useEffect(() => {
		function show(event: KeyboardEvent) {
			if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return
			if (
				event.target instanceof HTMLElement &&
				event.target.closest('input, textarea, select, [contenteditable="true"]') !== null
			) {
				return
			}
			event.preventDefault()
			setOpen(true)
		}
		addEventListener('keydown', show)
		return () => removeEventListener('keydown', show)
	}, [])
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={<Button variant="ghost" size="icon-xs" className="max-sm:size-11" aria-label="Chart marks" />}
			>
				<span aria-hidden>?</span>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64">
				<PopoverHeader>
					<PopoverTitle>{props.title ?? 'Marks'}</PopoverTitle>
				</PopoverHeader>
				<ul className="flex flex-col gap-2 text-xs">
					{Array.map(props.items, item => (
						<li key={item.label} className="flex items-center gap-2.5">
							<span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
								{item.mark}
							</span>
							<span className="min-w-0">{item.label}</span>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	)
}
