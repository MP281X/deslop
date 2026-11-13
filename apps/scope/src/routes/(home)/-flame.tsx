import {Array, Boolean, Match, Number, Option, Record, String, pipe} from 'effect'

// oxlint-disable-next-line eslint/no-restricted-imports -- useLayoutEffect: the flame measures its surface and label widths after layout and before paint, so bars never draw at a stale width.
import {useLayoutEffect, useRef, useState} from 'react'

import {APP_HUES} from '@deslop/components-web/apps'
import {cn} from '@deslop/components-web/classes'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {lanesOf} from '#lib/flame.ts'
import {durationOf} from '#lib/telemetry.ts'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {TraceTree} from '#services/telemetry/schema.ts'

// The flame's lanes: a 22px bar with 2px between lanes, and a 6px-padded label inside it.
const FLAME_LANE = 24
const FLAME_BAR = 22
const FLAME_LABEL_PADDING = 12

// The flame's 22px lanes while its trace loads, including a lane with two sibling bars; no axis, which the real pane draws only with data.
export function SpansSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status" className="px-4 pt-1.5 pb-2">
			<div
				className="relative h-(--flame-height)"
				style={{'--flame-height': `${4 * FLAME_LANE - (FLAME_LANE - FLAME_BAR)}px`}}
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
							className="absolute top-(--flame-top) left-(--flame-left) h-5.5 w-(--flame-width)"
							style={{'--flame-left': `${box.left}%`, '--flame-top': `${box.top}px`, '--flame-width': `${box.width}%`}}
						/>
					)
				)}
			</div>
		</div>
	)
}

// The trace's time scale: start, quarters and total, in tabular figures, pinned while the lanes scroll under it.
export function TimeAxis(props: {totalMs: number}) {
	const total = Number.max(props.totalMs, 1)
	return (
		<div className="text-muted-foreground bg-background sticky top-0 z-10 h-6 shrink-0 border-b px-4 text-xs tabular-nums">
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

function labelOf(span: TraceTree['spans'][number]) {
	return `${span.name} · ${durationOf(span.durationMs)}`
}

// One lane per job, deeper spans packed into free time; the root and each job carry their full name and time inside the bar while they fit, else after it in the lane's free time, never clipped.
export function Flame(props: {focus?: string; onPick: (id: string) => void; trace: TraceTree}) {
	const total = Number.max(props.trace.durationMs, 1)
	const [width, setWidth] = useState(0)
	const [labelWidths, setLabelWidths] = useState<Record<string, number>>({})
	const surface = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		function measure() {
			if (surface.current === null) return
			setWidth(surface.current.getBoundingClientRect().width)
			const probe = surface.current.ownerDocument.createElement('span')
			probe.className = 'pointer-events-none invisible absolute text-xs whitespace-nowrap'
			surface.current.appendChild(probe)
			const widths = Record.fromEntries(
				pipe(
					props.trace.spans,
					Array.filter(span => span.depth <= 1),
					Array.map(span => {
						probe.textContent = labelOf(span)
						return [span.spanId, probe.getBoundingClientRect().width] as const
					})
				)
			)
			probe.remove()
			setLabelWidths(widths)
		}
		measure()
		const observer = new ResizeObserver(measure)
		if (surface.current !== null) observer.observe(surface.current)
		return () => observer.disconnect()
	}, [props.trace])
	const placed = lanesOf(
		props.trace.spans,
		Record.fromEntries(
			pipe(
				props.trace.spans,
				Array.filter(span => span.depth <= 1),
				Array.flatMap((span: TraceTree['spans'][number]) => {
					const measured = Option.getOrElse(Record.get(labelWidths, span.spanId), () => 0)
					const bar = Number.max((span.durationMs / total) * width, 2)
					if (bar >= measured + FLAME_LABEL_PADDING) return []
					if ((span.offsetMs / total) * width + bar + 4 + measured > width) return []
					return [[span.spanId, ((measured + 8) / width) * total] as const]
				})
			)
		)
	)
	const spansById = Record.fromEntries(Array.map(props.trace.spans, span => [span.spanId, span] as const))
	const placedByLane = Array.groupBy(placed, entry => `${entry.lane}`)
	const lanes = Array.reduce(placed, 0, (deepest, entry) => Number.max(deepest, entry.lane + 1))
	const rows = Array.map(placed, entry => {
		const span = entry.span
		const duration = durationOf(span.durationMs)
		const left = (span.offsetMs / total) * width
		const bar = Number.max((span.durationMs / total) * width, 2)
		const measured = Option.getOrElse(Record.get(labelWidths, span.spanId), () => 0)
		const inside = span.depth <= 1 && width > 0 && bar >= measured + FLAME_LABEL_PADDING
		const labelLeft = left + bar + 4
		const labelRight = labelLeft + measured
		const after =
			span.depth <= 1 &&
			!inside &&
			width > 0 &&
			labelRight <= width &&
			Array.every(
				Option.getOrElse(Record.get(placedByLane, `${entry.lane}`), () => []),
				other => {
					if (other.span.spanId === span.spanId) return true
					const otherLeft = (other.span.offsetMs / total) * width
					const otherRight = otherLeft + Number.max((other.span.durationMs / total) * width, 2)
					return labelRight <= otherLeft || otherRight <= labelLeft
				}
			)
		return {
			after,
			bar,
			description: pipe(
				span.parentSpanId,
				Option.flatMap(id => Record.get(spansById, id)),
				Option.match({
					onNone: () => `${span.name} ${duration}`,
					onSome: parent => `${parent.name} · ${span.name} ${duration}`
				})
			),
			duration,
			hit: Number.max(bar + Boolean.match(after, {onFalse: () => 0, onTrue: () => measured + 4}), 12),
			inside,
			label: labelOf(span),
			lane: entry.lane,
			left,
			picked: span.spanId === props.focus,
			span
		}
	})
	function moveFocus(span: TraceTree['spans'][number], key: string) {
		const siblings = Array.filter(props.trace.spans, other => other.depth === span.depth)
		const index = pipe(
			siblings,
			Array.findFirstIndex(other => other.spanId === span.spanId),
			Option.getOrElse(() => 0)
		)
		Option.match(
			pipe(
				Match.value(key),
				Match.when('ArrowLeft', () => Array.get(siblings, index - 1)),
				Match.when('ArrowRight', () => Array.get(siblings, index + 1)),
				Match.when('ArrowUp', () =>
					Array.findFirst(props.trace.spans, other => Option.contains(span.parentSpanId, other.spanId))
				),
				Match.when('ArrowDown', () =>
					Array.findFirst(props.trace.spans, other => Option.contains(other.parentSpanId, span.spanId))
				),
				Match.orElse(() => Option.none<TraceTree['spans'][number]>())
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
				className="relative h-(--flame-height) w-full"
				style={{'--flame-height': `${lanes * FLAME_LANE - (FLAME_LANE - FLAME_BAR)}px`}}
			>
				{Array.map(rows, row => (
					<div
						key={row.span.spanId}
						data-flame-bar=""
						data-span-id={row.span.spanId}
						className="has-[:focus-visible]:outline-ring absolute top-(--flame-top) left-(--flame-left) h-5.5 w-(--flame-width) has-[:focus-visible]:outline-2"
						style={{
							'--app': APP_HUES[appName(row.span.service)] ?? 'var(--muted-foreground)',
							'--flame-left': `${row.left}px`,
							'--flame-top': `${row.lane * FLAME_LANE}px`,
							'--flame-width': `${row.hit}px`
						}}
					>
						<span
							aria-hidden
							data-flame-fill={Boolean.match(row.bar > 2, {onFalse: () => undefined, onTrue: () => '' as const})}
							className={cn(
								'absolute inset-y-0 left-0 w-(--flame-bar) overflow-hidden',
								Boolean.match(row.span.status === 'failed', {
									onFalse: () => 'bg-(--app)',
									onTrue: () => 'bg-destructive'
								}),
								Boolean.match(row.picked, {
									onFalse: () => undefined,
									onTrue: () => 'outline-1 outline-foreground outline-offset-[-1px]'
								})
							)}
							style={{'--flame-bar': `${row.bar}px`}}
						>
							{Boolean.match(row.inside, {
								onFalse: () => null,
								onTrue: () => (
									<span className="text-background flex h-full items-center px-1.5 text-xs whitespace-nowrap">
										{row.label}
									</span>
								)
							})}
						</span>
						{Boolean.match(row.after, {
							onFalse: () => null,
							onTrue: () => (
								<span
									aria-hidden
									className="absolute top-1/2 left-(--flame-label) -translate-y-1/2 text-xs whitespace-nowrap"
									style={{'--flame-label': `${row.bar + 4}px`}}
								>
									<span className="text-foreground">{row.span.name}</span>
									<span className="text-muted-foreground">{` · ${row.duration}`}</span>
								</span>
							)
						})}
						<button
							type="button"
							aria-current={Boolean.match(row.picked, {onFalse: () => undefined, onTrue: () => 'true' as const})}
							aria-label={row.description}
							title={row.description}
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
