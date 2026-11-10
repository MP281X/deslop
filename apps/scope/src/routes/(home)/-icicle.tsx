import {Array, Boolean, Match, Number, Option, String, pipe} from 'effect'

import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {APP_HUES} from '@deslop/components-web/apps'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn} from '@deslop/components-web/utils'

import {durationOf} from '#lib/utils.ts'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {Trace} from '#services/telemetry/schema.ts'

// The icicle's lanes: a 22px box with 2px between lanes.
const ICICLE_LANE = 24
const ICICLE_BOX = 22

// The icicle measures its lane width before paint; a server render such as the page test has no window.
const useIsomorphicLayoutEffect = Boolean.match(typeof window === 'undefined', {
	onFalse: () => useLayoutEffect,
	onTrue: () => useEffect
})

// The icicle's 22px lanes while its trace loads, including a lane with two sibling boxes; no axis, which the real pane draws only with data.
export function SpansSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status" className="px-4 pt-1.5 pb-2">
			<div
				className="relative h-(--ice-height)"
				style={{'--ice-height': `${4 * ICICLE_LANE - (ICICLE_LANE - ICICLE_BOX)}px`}}
			>
				{Array.map(
					[
						{left: 0, top: 0, width: 100},
						{left: 2, top: 24, width: 97},
						{left: 6, top: 48, width: 2.5},
						{left: 10, top: 48, width: 89},
						{left: 14, top: 72, width: 85}
					],
					(box, index) => (
						<Skeleton
							key={index}
							aria-hidden
							className="absolute top-(--ice-top) left-(--ice-left) h-5.5 w-(--ice-width)"
							style={{'--ice-left': `${box.left}%`, '--ice-top': `${box.top}px`, '--ice-width': `${box.width}%`}}
						/>
					)
				)}
			</div>
		</div>
	)
}

// The trace's time scale: start, quarters and total, in tabular figures.
export function TimeAxis(props: {totalMs: number}) {
	const total = Number.max(props.totalMs, 1)
	return (
		<div className="text-muted-foreground h-6 shrink-0 border-b px-4 text-xs tabular-nums">
			<div className="relative h-full">
				{Array.map([0, 0.25, 0.5, 0.75, 1] as const, ratio => (
					<span
						key={ratio}
						className={cn(
							'absolute top-1/2 left-(--axis-left) -translate-y-1/2 whitespace-nowrap',
							Boolean.match(ratio === 0, {
								onFalse: () =>
									Boolean.match(ratio === 1, {onFalse: () => '-translate-x-1/2', onTrue: () => '-translate-x-full'}),
								onTrue: () => undefined
							})
						)}
						style={{'--axis-left': `${ratio * 100}%`}}
					>
						{Boolean.match(ratio === 0, {onFalse: () => durationOf(total * ratio), onTrue: () => '0'})}
					</span>
				))}
			</div>
		</div>
	)
}

// One lane per span depth, each span a box on the trace's time scale with its name and duration inside; arrow keys walk the tree.
export function Icicle(props: {focus?: string; onPick: (id: string) => void; trace: Trace}) {
	const total = Number.max(props.trace.durationMs, 1)
	const lanes = Array.reduce(props.trace.spans, 0, (deepest, span) => Number.max(deepest, span.depth)) + 1
	const [width, setWidth] = useState(0)
	const surface = useRef<HTMLDivElement>(null)
	useIsomorphicLayoutEffect(() => {
		const element = surface.current
		if (element === null) return
		setWidth(element.getBoundingClientRect().width)
		const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])
	const rows = Array.map(props.trace.spans, span => {
		const fraction = span.durationMs / total
		const time = durationOf(span.durationMs)
		return {
			label: `${span.name} ${time}`,
			// 8px covers the 12px mono face's advance; 6px pads the box and separates its name and time.
			labelled: width === 0 || fraction * width >= time.length * 8 + 6 * 2 + 6,
			left: (span.offsetMs / total) * 100,
			picked: span.spanId === props.focus,
			span,
			time,
			top: span.depth * ICICLE_LANE,
			width: fraction * 100
		}
	})
	function moveFocus(span: Trace['spans'][number], key: string) {
		const siblings = Array.filter(props.trace.spans, other => other.depth === span.depth)
		const index = Option.getOrElse(
			Array.findFirstIndex(siblings, other => other.spanId === span.spanId),
			() => 0
		)
		Option.match(
			pipe(
				Match.value(key),
				Match.when('ArrowLeft', () => Array.get(siblings, index - 1)),
				Match.when('ArrowRight', () => Array.get(siblings, index + 1)),
				Match.when('ArrowUp', () => Array.findFirst(props.trace.spans, other => other.spanId === span.parentSpanId)),
				Match.when('ArrowDown', () => Array.findFirst(props.trace.spans, other => other.parentSpanId === span.spanId)),
				Match.orElse(() => Option.none<Trace['spans'][number]>())
			),
			{
				onNone: () => undefined,
				onSome: next =>
					surface.current?.querySelector<HTMLButtonElement>(`[data-span-id="${next.spanId}"] button`)?.focus()
			}
		)
	}
	return (
		<div className="mt-1.5 mb-2 px-4">
			<div
				ref={surface}
				role="group"
				aria-label="Spans"
				className="relative h-(--ice-height) w-full"
				style={{'--ice-height': `${lanes * ICICLE_LANE - (ICICLE_LANE - ICICLE_BOX)}px`}}
			>
				{Array.map(rows, row => (
					<div
						key={row.span.spanId}
						data-icicle-box=""
						data-span-id={row.span.spanId}
						className="has-[:focus-visible]:outline-ring absolute top-(--span-top) left-(--span-left) h-5.5 w-(--span-width) min-w-px has-[:focus-visible]:outline-2"
						// A span's box takes the hue of the app that ran it; a source without a Deslop mark stays zinc.
						style={{
							'--app': APP_HUES[appName(row.span.service)] ?? 'var(--muted-foreground)',
							'--span-left': `${row.left}%`,
							'--span-top': `${row.top}px`,
							'--span-width': `${row.width}%`
						}}
					>
						<span
							aria-hidden
							className={cn(
								'text-background absolute inset-0 flex items-center overflow-hidden text-xs',
								Boolean.match(row.labelled, {onFalse: () => undefined, onTrue: () => 'px-1.5'}),
								Boolean.match(row.span.status === 2, {onFalse: () => 'bg-(--app)', onTrue: () => 'bg-destructive'}),
								Boolean.match(row.picked, {
									onFalse: () => undefined,
									onTrue: () => 'outline-1 outline-foreground outline-offset-[-1px]'
								})
							)}
						>
							{Boolean.match(row.labelled, {
								onFalse: () => null,
								onTrue: () => (
									<span className="flex w-full min-w-0 items-center justify-between gap-1.5">
										<span className="min-w-0 truncate">{row.span.name}</span>
										<span className="shrink-0 opacity-70">{row.time}</span>
									</span>
								)
							})}
						</span>
						<button
							type="button"
							aria-current={Boolean.match(row.picked, {onFalse: () => undefined, onTrue: () => 'true' as const})}
							aria-label={row.label}
							title={row.label}
							onClick={() => props.onPick(row.span.spanId)}
							onKeyDown={event => {
								if (String.startsWith('Arrow')(event.key)) {
									event.preventDefault()
									moveFocus(row.span, event.key)
								}
							}}
							className="absolute inset-0 h-full w-full border-0 bg-transparent p-0 outline-none"
						/>
					</div>
				))}
			</div>
		</div>
	)
}
