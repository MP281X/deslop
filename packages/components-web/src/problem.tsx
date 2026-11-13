import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Duration, Effect, Number, Option, Stream, pipe} from 'effect'

import {ArrowClockwiseIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useId, useRef, useState} from 'react'

import {StatusDot} from '#components/status-dot.tsx'
import {Button} from '#components/ui/button.tsx'
import {Popover, PopoverContent, PopoverTitle, PopoverTrigger} from '#components/ui/popover.tsx'

// The page keeps this reader mounted even when its pane is offscreen.
// judge-ignore no-silent-fallback -- now is when the problem began, not a stand-in for a failed read.
// fallow-ignore-next-line unused-export -- the tests drive the age this atom keeps directly.
export const problemSinceAtom = Atom.family((source: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>) =>
	Atom.make(get => {
		if (!AsyncResult.isFailure(get(source))) return Option.none<DateTime.Utc>()
		return Option.orElse(Option.flatten(get.self<Option.Option<DateTime.Utc>>()), () =>
			Option.some(DateTime.nowUnsafe())
		)
	})
)

// fallow-ignore-next-line unused-export -- the oldest reader still showing content, whose tests drive the age and retry protocol directly.
export const staleSinceAtom = Atom.family((readers: readonly Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>[]) =>
	Atom.readable(
		get =>
			pipe(
				readers,
				Array.flatMap(reader => {
					const result = get(reader)
					if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return []
					return Option.toArray(get(problemSinceAtom(reader)))
				}),
				Array.match({
					onEmpty: () => Option.none<DateTime.Utc>(),
					onNonEmpty: ages => Option.some(Array.min(ages, DateTime.Order))
				})
			),
		refresh => Array.forEach(readers, reader => refresh(reader))
	)
)

const ageAtom = Atom.family((identity: DateTime.Utc | string) =>
	Atom.make(
		Stream.unwrap(
			Effect.map(DateTime.now, started =>
				Stream.mapEffect(Stream.tick('1 second'), () =>
					Effect.map(DateTime.now, now => {
						const age = pipe(
							identity,
							Option.liftPredicate(DateTime.isDateTime),
							Option.getOrElse(() => started),
							DateTime.distance(now)
						)
						const seconds = Number.max(0, Math.floor(Duration.toSeconds(age)))
						if (seconds < 60) return `${seconds}s`
						if (seconds < 3600) return `${Math.floor(Duration.toMinutes(age))}m`
						if (seconds < 86_400) return `${Math.floor(Duration.toHours(age))}h`
						return `${Math.floor(Duration.toDays(age))}d`
					})
				)
			)
		)
	)
)

// The popup works with hover, keyboard and touch.
function Problem(props: {label: string; reset?: () => void; since?: DateTime.Utc}) {
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
				className="h-8 w-16 max-sm:h-11"
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
				<StatusDot status="warning" />
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
			</PopoverContent>
		</Popover>
	)
}

// One stale mark per page: the oldest reader still showing content, and its retry refreshes them all.
export function StaleProblem(props: {
	label: string
	readers: readonly Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>[]
}) {
	const since = useAtomValue(staleSinceAtom(props.readers))
	const retry = useAtomRefresh(staleSinceAtom(props.readers))
	return Option.match(since, {
		onNone: () => null,
		onSome: value => <Problem label={props.label} reset={retry} since={value} />
	})
}
