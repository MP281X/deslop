import {Array, Boolean, Match, Number, Option, String, pipe} from 'effect'

import {useState} from 'react'
import type {PointerEvent} from 'react'

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@deslop/components-web/ui/tooltip'
import {cn} from '@deslop/components-web/utils'

import {chartTicks} from '#routes/(home)/-chart.ts'
import {runs} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const HEIGHT = 64
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})

// One stacked band: its share at each sample, and the number its tooltip names, in bytes or per cent.
export type ChartLayer = {
	kind: Band['kind'] | 'disk'
	id: string
	opacity: number
	readings: readonly number[]
	values: readonly number[]
}

// A run of one sample still gets a slot's width, so a lone reading shows.
function widen(run: readonly {index: number; x: number}[]) {
	if (run.length !== 1) return run
	return [{index: run[0]?.index ?? 0, x: (run[0]?.x ?? 0) - 100 / 60}, ...run]
}

function y(percent: number, height: number) {
	return height - (Number.clamp(percent, {maximum: 100, minimum: 0}) / 100) * height
}

function x(history: MachineHistory, minutes: number, at: number) {
	const window = chartWindow(minutes, history.time)
	return ((at - window.start) / (window.end - window.start)) * 100
}

// The sample nearest the pointer's horizontal place on the chart.
function nearest(history: MachineHistory, minutes: number, at: number) {
	return Array.reduce(history.samples, {distance: 101, index: 0}, (best, sample, index) => {
		const distance = Math.abs(x(history, minutes, sample.time) - at)
		if (distance < best.distance) return {distance, index}
		return best
	}).index
}

// A band's colour: a Deslop app in its icon's hue, a service without one a zinc step, small apps and the rest two darker greys.
function fillOf(
	band: {kind: ChartLayer['kind']; opacity: number},
	name: string,
	hue: (name: string) => Option.Option<string>
) {
	if (band.kind === 'other') return {color: 'var(--input)', opacity: 1}
	if (band.kind === 'system') return {color: 'var(--muted)', opacity: 1}
	if (band.kind === 'disk') return {color: 'var(--muted-foreground)', opacity: 0.6}
	return Option.match(hue(name), {
		onNone: () => ({color: 'var(--muted-foreground)', opacity: band.opacity}),
		onSome: color => ({color, opacity: 0.9})
	})
}

// The machine's share each band holds over time, stacked on the whole machine's 0–100%, with a tooltip and cursor on the hovered band.
export function UsageChart(props: {
	className?: string
	cover?: boolean
	format: (value: number) => string
	history: MachineHistory
	hue: (name: string) => Option.Option<string>
	label: string
	layers: readonly ChartLayer[]
	minutes: number
	names: (id: string) => string
	recorded: (sample: Sample) => boolean
}) {
	const [cursor, setCursor] = useState<{index: number; x: number; y: number}>()
	const [hoverBand, setHoverBand] = useState<ChartLayer>()
	const hovered = Option.all([Option.fromUndefinedOr(cursor), Option.fromUndefinedOr(hoverBand)])
	function move(event: PointerEvent<SVGSVGElement>) {
		const bounds = event.currentTarget.getBoundingClientRect()
		const index = nearest(props.history, props.minutes, ((event.clientX - bounds.left) / bounds.width) * 100)
		setCursor({
			index,
			x: x(props.history, props.minutes, props.history.samples[index]?.time ?? 0),
			y: ((event.clientY - bounds.top) / bounds.height) * 100
		})
		Option.match(Array.head(props.layers), {
			onNone: () => undefined,
			onSome: first =>
				Boolean.match(props.cover === true, {onFalse: () => undefined, onTrue: () => setHoverBand(first)})
		})
	}
	function leave() {
		setCursor(undefined)
		setHoverBand(undefined)
	}
	return (
		<TooltipProvider delay={0}>
			<Tooltip open={Option.isSome(hovered)}>
				<figure className={cn('relative flex min-h-0 flex-col', props.className)} aria-label={props.label}>
					<svg
						viewBox={`0 0 100 ${HEIGHT}`}
						preserveAspectRatio="none"
						className="size-full overflow-visible"
						role="img"
						aria-label={`${props.label} over time; blank time is unrecorded`}
						onPointerLeave={leave}
						onPointerMove={move}
					>
						{Array.map(chartTicks(props.minutes, props.history.time), tick => (
							<line
								key={tick.at}
								x1={tick.x}
								x2={tick.x}
								y1="0"
								y2={HEIGHT}
								stroke="var(--border)"
								strokeOpacity="0.5"
								vectorEffect="non-scaling-stroke"
								pointerEvents="none"
							/>
						))}
						<line
							x1="0"
							x2="100"
							y1={HEIGHT / 2}
							y2={HEIGHT / 2}
							stroke="var(--border)"
							strokeDasharray="3 3"
							vectorEffect="non-scaling-stroke"
							pointerEvents="none"
						/>
						{Array.map(
							// Each band sits on the ones before it.
							Array.mapAccum(
								props.layers,
								Array.map(props.history.samples, () => 0),
								(bottom, band) => {
									const top = Array.map(bottom, (value, index) => value + (band.values[index] ?? 0))
									return [top, {band, bottom, top}]
								}
							)[1],
							layer => {
								const fill = fillOf(layer.band, props.names(layer.band.id), props.hue)
								return Array.map(Array.map(runs(props.history, props.minutes, props.recorded), widen), run => (
									<polygon
										key={`${layer.band.id}:${run[0]?.x}`}
										points={Array.join(
											[
												...Array.map(run, point => `${point.x},${y(layer.top[point.index] ?? 0, HEIGHT)}`),
												...Array.map(
													Array.reverse(run),
													point => `${point.x},${y(layer.bottom[point.index] ?? 0, HEIGHT)}`
												)
											],
											' '
										)}
										fill={fill.color}
										fillOpacity={fill.opacity}
										stroke="var(--background)"
										strokeWidth="0.6"
										vectorEffect="non-scaling-stroke"
										onPointerEnter={() => setHoverBand(layer.band)}
									/>
								))
							}
						)}
						{Option.match(Option.fromUndefinedOr(cursor), {
							onNone: () => null,
							onSome: value => (
								<line
									x1={value.x}
									x2={value.x}
									y1="0"
									y2={HEIGHT}
									stroke="var(--foreground)"
									strokeOpacity="0.35"
									vectorEffect="non-scaling-stroke"
									pointerEvents="none"
								/>
							)
						})}
						<line
							x1="0"
							x2="100"
							y1={HEIGHT}
							y2={HEIGHT}
							stroke="var(--border)"
							vectorEffect="non-scaling-stroke"
							pointerEvents="none"
						/>
					</svg>
					<TooltipTrigger
						render={
							<span
								aria-hidden="true"
								className="pointer-events-none absolute top-(--tip-y) left-(--tip-x) size-px"
								style={{
									'--tip-x': `${Option.getOrElse(
										Option.map(Option.fromUndefinedOr(cursor), value => value.x),
										() => 0
									)}%`,
									'--tip-y': `${Option.getOrElse(
										Option.map(Option.fromUndefinedOr(cursor), value => value.y),
										() => 0
									)}%`
								}}
							/>
						}
					/>
				</figure>
				{Option.match(hovered, {
					onNone: () => null,
					onSome: value => (
						<TooltipContent side="top" sideOffset={6} align="start" className="pointer-events-none">
							<span className="font-medium">{props.names(value[1].id)}</span>
							<span className="opacity-70">{time.format(props.history.samples[value[0].index]?.time ?? 0)}</span>
							<span className="font-mono tabular-nums">{props.format(value[1].readings[value[0].index] ?? 0)}</span>
						</TooltipContent>
					)
				})}
			</Tooltip>
		</TooltipProvider>
	)
}

// HTML time labels under a chart, so they keep their shape whatever the chart's scale; clock-aligned ticks match the grid.
export function TimeAxis(props: {className?: string; minutes: number; now: number}) {
	return (
		<div
			aria-hidden="true"
			className={cn('text-muted-foreground relative h-4 font-mono text-xs tabular-nums', props.className)}
		>
			{Array.map(
				Array.filter(chartTicks(props.minutes, props.now), tick => tick.label),
				tick => (
					<span
						key={tick.at}
						className={cn(
							'absolute top-0 left-(--tick-x) whitespace-nowrap',
							Boolean.match(tick.x < 8, {
								onFalse: () =>
									Boolean.match(tick.x > 92, {onFalse: () => '-translate-x-1/2', onTrue: () => '-translate-x-full'}),
								onTrue: () => ''
							})
						)}
						style={{'--tick-x': `${tick.x}%`}}
					>
						{pipe(
							Match.value(props.minutes),
							// A minute reads as the minute, then its quarters as seconds, so four labels fit a narrow chart.
							Match.when(1, () =>
								Boolean.match(tick.at % 60_000 === 0, {
									onFalse: () => `:${String.padStart(2, '0')(`${(tick.at % 60_000) / 1000}`)}`,
									onTrue: () => time.format(tick.at)
								})
							),
							Match.when(10_080, () => date.format(tick.at)),
							Match.orElse(() => time.format(tick.at))
						)}
					</span>
				)
			)}
		</div>
	)
}
