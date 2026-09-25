import {Predicate} from 'effect'

import {cn} from '#lib/utils.ts'

export function TreeExplorer(props: {className?: string; children: React.ReactNode}) {
	return <div className={cn('flex min-h-0 flex-1 flex-col', props.className)}>{props.children}</div>
}

export function TreeExplorerSection(props: {label?: React.ReactNode; className?: string; children: React.ReactNode}) {
	return (
		<section className={cn('flex flex-col gap-1', props.className)}>
			{Predicate.isNotUndefined(props.label) && (
				// oxlint-disable-next-line shadcn/no-arbitrary-values -- no grid-cols scale step gives a shrinkable label column beside an auto column.
				<div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 pt-2 font-normal">
					{props.label}
				</div>
			)}
			<ul className="flex flex-col gap-0.5 px-0">{props.children}</ul>
		</section>
	)
}

export function TreeExplorerRow(props: {
	selected?: boolean
	onClick?: () => void
	icon?: React.ReactNode
	actions?: React.ReactNode
	title?: string
	children: React.ReactNode
}) {
	const className = cn(
		// oxlint-disable-next-line shadcn/no-arbitrary-values -- no grid-cols scale step gives a shrinkable label column beside an auto column.
		'text-muted-foreground hover:bg-muted/60 hover:text-foreground grid h-7 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-2 pl-3 text-left font-normal',
		props.selected === true &&
			// oxlint-disable-next-line shadcn/no-arbitrary-values -- no shadow scale step draws a 1px inset accent bar on the left edge.
			'bg-muted text-foreground hover:bg-muted shadow-[inset_1px_0_0_var(--color-primary)]'
	)
	const label = (
		<span className="flex h-full min-w-0 flex-1 items-center gap-1.5">
			{Predicate.isNotUndefined(props.icon) && (
				<span className="flex size-3 shrink-0 items-center justify-center [&_svg]:size-3 [&_svg]:shrink-0">
					{props.icon}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate">{props.children}</span>
		</span>
	)

	if (Predicate.isNotUndefined(props.onClick) && Predicate.isNotUndefined(props.actions)) {
		return (
			<div aria-current={props.selected === true ? 'page' : undefined} className={className} title={props.title}>
				<button
					type="button"
					onClick={props.onClick}
					className="flex h-full min-w-0 items-center border-0 bg-transparent p-0 text-left text-inherit"
				>
					{label}
				</button>
				{props.actions}
			</div>
		)
	}

	if (Predicate.isNotUndefined(props.onClick)) {
		return (
			<button
				type="button"
				aria-current={props.selected === true ? 'page' : undefined}
				onClick={props.onClick}
				className={className}
				title={props.title}
			>
				{label}
				{props.actions}
			</button>
		)
	}

	return (
		<div className={className} title={props.title}>
			{label}
			{props.actions}
		</div>
	)
}
