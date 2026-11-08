import {useAtomValue} from '@effect/atom-react'

import {Boolean, Clock, DateTime, Effect, Number, Option, Predicate, Stream} from 'effect'

import {ArrowClockwiseIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useId, useRef, useState} from 'react'

import {StatusDot} from '#components/status-dot.tsx'
import {Button} from '#components/ui/button.tsx'
import {Popover, PopoverContent, PopoverTitle, PopoverTrigger} from '#components/ui/popover.tsx'
import {cn} from '#lib/utils.ts'

// The page keeps this reader mounted even when its pane is offscreen.
export const problemSinceAtom = Atom.family((source: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>) =>
	Atom.make(get => {
		if (!AsyncResult.isFailure(get(source))) return Option.none<number>()
		return Option.orElse(Option.flatten(get.self<Option.Option<number>>()), () =>
			Option.some(DateTime.toEpochMillis(DateTime.nowUnsafe()))
		)
	})
)

const ageAtom = Atom.family((identity: number | string) =>
	Atom.make(
		Stream.unwrap(
			Effect.map(Clock.currentTimeMillis, started =>
				Stream.mapEffect(Stream.tick('1 second'), () =>
					Effect.map(Clock.currentTimeMillis, now => {
						const seconds = Number.max(
							0,
							Math.floor(
								(now - Option.getOrElse(Option.filter(Option.some(identity), Predicate.isNumber), () => started)) / 1000
							)
						)
						if (seconds < 60) return `${seconds}s`
						if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
						if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
						return `${Math.floor(seconds / 86_400)}d`
					})
				)
			)
		)
	)
)

// One problem belongs beside the affected content. The popup works with hover, keyboard and touch.
export function Problem(props: {
	className?: string
	description?: string
	label: string
	reset?: () => void
	since?: number
	warning?: boolean
}) {
	const id = useId()
	const age = useAtomValue(ageAtom(props.since ?? id))
	const [open, setOpen] = useState(false)
	const content = useRef<HTMLDivElement>(null)
	const retry = useRef<HTMLButtonElement>(null)
	const returning = useRef(false)
	return (
		<Popover
			open={open}
			triggerId={id}
			onOpenChange={(next, details) => {
				if (!next && details.reason === 'escape-key') returning.current = true
				if (!next && details.reason === 'trigger-press') {
					retry.current?.focus()
					return
				}
				setOpen(next)
			}}
		>
			<PopoverTrigger
				id={id}
				render={<Button variant="ghost" size="sm" />}
				openOnHover
				delay={150}
				aria-label={props.label}
				className={cn('h-8 w-16 max-sm:h-11', props.className)}
				onFocus={event => {
					if (returning.current) {
						returning.current = false
						return
					}
					if (
						event.currentTarget.matches(':focus-visible') &&
						content.current?.contains(event.relatedTarget) !== true
					) {
						setOpen(true)
					}
				}}
				onBlur={() => {
					returning.current = false
				}}
			>
				<StatusDot status={Boolean.match(props.warning === true, {onFalse: () => 'error', onTrue: () => 'warning'})} />
				<span aria-hidden className="text-muted-foreground font-mono tabular-nums">
					{Option.getOrElse(AsyncResult.value(age), () => '0s')}
				</span>
			</PopoverTrigger>
			<PopoverContent ref={content} initialFocus={false} className="w-auto max-w-xs" align="end">
				<div className="flex items-center gap-3">
					<PopoverTitle>{props.label}</PopoverTitle>
					{props.reset !== undefined && (
						<Button
							ref={retry}
							variant="ghost"
							size="icon"
							className="max-sm:size-11"
							aria-label="Try again"
							title="Try again"
							onClick={props.reset}
						>
							<ArrowClockwiseIcon className="size-4" />
						</Button>
					)}
				</div>
				{props.description !== undefined && (
					<p className="text-muted-foreground mt-1 text-xs leading-relaxed">{props.description}</p>
				)}
			</PopoverContent>
		</Popover>
	)
}
