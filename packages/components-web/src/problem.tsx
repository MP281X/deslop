import {useAtomValue} from '@effect/atom-react'

import {Boolean, Clock, Effect, Number, Option, Stream} from 'effect'

import {ArrowClockwiseIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useId} from 'react'

import {StatusDot} from '#components/status-dot.tsx'
import {Button} from '#components/ui/button.tsx'
import {Popover, PopoverContent, PopoverTitle, PopoverTrigger} from '#components/ui/popover.tsx'
import {cn} from '#lib/utils.ts'

const ageAtom = Atom.family((_id: string) =>
	Atom.make(
		Stream.unwrap(
			Effect.map(Clock.currentTimeMillis, since =>
				Stream.mapEffect(Stream.tick('1 second'), () =>
					Effect.map(Clock.currentTimeMillis, now => {
						const seconds = Number.max(0, Math.floor((now - since) / 1000))
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
export function Problem(props: {className?: string; label: string; reset?: () => void; warning?: boolean}) {
	const age = useAtomValue(ageAtom(useId()))
	return (
		<Popover>
			<PopoverTrigger
				render={<Button variant="ghost" size="sm" />}
				openOnHover
				delay={150}
				aria-label={props.label}
				className={cn('h-8 w-16 max-sm:h-11', props.className)}
			>
				<StatusDot status={Boolean.match(props.warning === true, {onFalse: () => 'error', onTrue: () => 'warning'})} />
				<span aria-hidden className="text-muted-foreground font-mono tabular-nums">
					{Option.getOrElse(AsyncResult.value(age), () => '0s')}
				</span>
			</PopoverTrigger>
			<PopoverContent className="w-auto max-w-xs" align="end">
				<div className="flex items-center gap-3">
					<PopoverTitle>{props.label}</PopoverTitle>
					{props.reset !== undefined && (
						<Button
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
