import type {Record} from 'effect'
import {Array, Boolean, DateTime, Duration, Function, Match, Number, Option, Order, Schema, String, pipe} from 'effect'

import {ChartLineIcon} from '@phosphor-icons/react'
import {useState} from 'react'
import type {PointerEvent} from 'react'

import {cn} from '@deslop/components-web/classes'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@deslop/components-web/ui/tooltip'
import {bytesOf, clockOf, dayOf, percentOf} from '@deslop/runtime/shared/format'

import {chartTicks} from '#routes/(home)/-chart.ts'
import {bandFill, bands, focusedBand, runs} from '#routes/(home)/-usage.ts'
import type {Band, BandFillKind} from '#routes/(home)/-usage.ts'
import type {AppId} from '#services/inventory/schema.ts'
import {bandName, chartWindow} from '#services/metrics/lib/utils.ts'
import {BandId} from '#services/metrics/schema.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const HEIGHT = 64
const CHART_LABELS = ['Memory', 'CPU', 'Disk'] as const

type ChartLayerId = typeof ChartLayerId.Type
const ChartLayerId = Schema.Union([BandId, Schema.Literal('disk')])

// One stacked band: its share at each sample, and the number its tooltip names, in bytes or per cent.
type ChartLayer = {
	kind: BandFillKind
	id: ChartLayerId
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

function x(history: MachineHistory, minutes: Duration.Duration, at: DateTime.Utc) {
	return (
		(Duration.toMillis(DateTime.distance(chartWindow(minutes, history.time).start, at)) / Duration.toMillis(minutes)) *
		100
	)
}

// The sample nearest the pointer's horizontal place on the chart.
function nearest(history: MachineHistory, minutes: Duration.Duration, at: number) {
	return pipe(
		history.samples,
		Array.map((sample, index) => ({distance: Math.abs(x(history, minutes, sample.time) - at), index})),
		Array.match({
			onEmpty: () => 0,
			onNonEmpty: entries =>
				Array.min(
					entries,
					Order.mapInput(Order.Number, entry => entry.distance)
				).index
		})
	)
}

// The machine's share each band holds over time, stacked on the whole machine's 0–100%, with a tooltip and cursor on the hovered band.
function UsageChart(props: {
	className?: string
	cover?: boolean
	focus?: Band['id']
	format: (value: number) => string
	history: MachineHistory
	label: string
	layers: readonly ChartLayer[]
	minutes: Duration.Duration
	names: (id: ChartLayer['id']) => string
	recorded: (sample: Sample) => boolean
}) {
	const [cursor, setCursor] = useState<{index: number; x: number; y: number}>()
	const [hoverBand, setHoverBand] = useState<ChartLayer>()
	const focused = Option.fromUndefinedOr(props.focus)
	const hovered = Option.all([Option.fromUndefinedOr(cursor), Option.fromUndefinedOr(hoverBand)])
	function move(event: PointerEvent<SVGSVGElement>) {
		const bounds = event.currentTarget.getBoundingClientRect()
		const index = nearest(props.history, props.minutes, ((event.clientX - bounds.left) / bounds.width) * 100)
		setCursor({
			index,
			x: pipe(
				props.history.samples,
				Array.get(index),
				Option.match({onNone: () => 0, onSome: sample => x(props.history, props.minutes, sample.time)})
			),
			y: ((event.clientY - bounds.top) / bounds.height) * 100
		})
		Option.match(Array.head(props.layers), {
			onNone: Function.constUndefined,
			onSome: first =>
				Boolean.match(props.cover === true, {onFalse: Function.constUndefined, onTrue: () => setHoverBand(first)})
		})
	}
	function leave() {
		setCursor(undefined)
		setHoverBand(undefined)
	}
	const allRuns = Array.map(runs(props.history, props.minutes, props.recorded), widen)
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
							Array.mapAccum(
								props.layers,
								Array.map(props.history.samples, () => 0),
								(bottom, band) => {
									const top = Array.map(bottom, (value, index) => value + (band.values[index] ?? 0))
									return [top, {band, bottom, top}]
								}
							)[1],
							layer => {
								const fill = bandFill(layer.band.kind, layer.band.opacity, props.names(layer.band.id))
								const isFocused = Option.exists(focused, focus => focus === layer.band.id)
								const dimmed = Option.isSome(focused) && !isFocused
								return Array.map(allRuns, run => (
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
										fillOpacity={Boolean.match(dimmed, {
											onFalse: () =>
												Boolean.match(isFocused, {
													onFalse: () => fill.opacity,
													onTrue: () => Number.max(fill.opacity, 0.9)
												}),
											onTrue: () => fill.opacity * 0.15
										})}
										stroke={Boolean.match(isFocused, {
											onFalse: () => 'var(--background)',
											onTrue: () => 'var(--foreground)'
										})}
										strokeOpacity={Boolean.match(isFocused, {onFalse: () => 1, onTrue: () => 0.7})}
										strokeWidth={Boolean.match(isFocused, {onFalse: () => 0.6, onTrue: () => 0.75})}
										vectorEffect="non-scaling-stroke"
										onPointerEnter={() => setHoverBand(layer.band)}
									/>
								))
							}
						)}
						{Option.match(Option.fromUndefinedOr(cursor), {
							onNone: Function.constNull,
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
									'--tip-x': `${pipe(
										Option.fromUndefinedOr(cursor),
										Option.map(value => value.x),
										Option.getOrElse(() => 0)
									)}%`,
									'--tip-y': `${pipe(
										Option.fromUndefinedOr(cursor),
										Option.map(value => value.y),
										Option.getOrElse(() => 0)
									)}%`
								}}
							/>
						}
					/>
				</figure>
				{Option.match(hovered, {
					onNone: Function.constNull,
					onSome: value => (
						<TooltipContent side="top" sideOffset={6} align="start" className="pointer-events-none">
							<span className="font-medium">{props.names(value[1].id)}</span>
							<span className="opacity-70">
								{pipe(
									props.history.samples,
									Array.get(value[0].index),
									Option.match({onNone: () => clockOf(DateTime.makeUnsafe(0)), onSome: sample => clockOf(sample.time)})
								)}
							</span>
							<span className="font-mono tabular-nums">{props.format(value[1].readings[value[0].index] ?? 0)}</span>
						</TooltipContent>
					)
				})}
			</Tooltip>
		</TooltipProvider>
	)
}

// HTML time labels under a chart, so they keep their shape whatever the chart's scale; clock-aligned ticks match the grid.
function TimeAxis(props: {className?: string; minutes: Duration.Duration; now: DateTime.Utc}) {
	return (
		<div
			aria-hidden="true"
			className={cn('text-muted-foreground relative h-4 font-mono text-xs tabular-nums', props.className)}
		>
			{pipe(
				chartTicks(props.minutes, props.now),
				Array.filter(tick => tick.label),
				Array.map(tick => (
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
							Match.value(Duration.toMinutes(props.minutes)),
							// A minute reads as the minute, then its quarters as seconds, so four labels fit a narrow chart.
							Match.when(1, () =>
								Boolean.match(tick.at % 60_000 === 0, {
									onFalse: () => `:${String.padStart(2, '0')(`${(tick.at % 60_000) / 1000}`)}`,
									onTrue: () => clockOf(DateTime.makeUnsafe(tick.at))
								})
							),
							Match.when(10_080, () => dayOf(DateTime.makeUnsafe(tick.at))),
							Match.orElse(() => clockOf(DateTime.makeUnsafe(tick.at)))
						)}
					</span>
				))
			)}
		</div>
	)
}

// One loading chart title: its static name, with only the server's figure left to load.
function ChartTitleSkeleton(props: {label: string}) {
	return (
		<div className="flex w-full items-center justify-between gap-2 text-xs">
			<span>{props.label}</span>
			<Skeleton className="h-4 w-10" />
		</div>
	)
}

export function ChartSkeleton(props: {isPhone: boolean; minutes: HistoryQuery['minutes']}) {
	const now = DateTime.nowUnsafe()
	return (
		<div aria-busy="true" aria-label="Usage history" role="status" className="flex shrink-0 flex-col border-b">
			{Boolean.match(props.isPhone, {
				onFalse: () => (
					<div className="grid h-8 grid-cols-3 items-center gap-6 border-b px-4">
						{Array.map(CHART_LABELS, label => (
							<ChartTitleSkeleton key={label} label={label} />
						))}
					</div>
				),
				onTrue: Function.constNull
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(CHART_LABELS, (label, index) => (
					<div key={label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: Function.constNull,
							onTrue: () => (
								<div className="flex h-8 items-center border-b">
									<ChartTitleSkeleton label={label} />
								</div>
							)
						})}
						<Skeleton className="h-16 w-full sm:h-32" />
						{Boolean.match(props.isPhone, {
							onFalse: () => <TimeAxis minutes={props.minutes} now={now} />,
							onTrue: () =>
								Boolean.match(index === 2, {
									onFalse: Function.constNull,
									onTrue: () => <TimeAxis minutes={props.minutes} now={now} />
								})
						})}
					</div>
				))}
			</div>
		</div>
	)
}

function ChartTitle(props: {figure: string; label: string}) {
	return (
		<div className="flex w-full items-baseline justify-between gap-2 text-xs">
			<span>{props.label}</span>
			<span className="tabular-nums">{props.figure}</span>
		</div>
	)
}

// The machine's three readings over time: apps stacked on the whole machine's 0–100%, and disk used as one band.
export function ChartBlock(props: {
	history: MachineHistory
	isPhone: boolean
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	selectedOwner?: AppId
}) {
	const all = bands(props.history)
	const focus = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(props.selectedOwner), selected => focusedBand(props.history, selected))
	)
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	const cpu = Option.flatMap(Option.fromUndefinedOr(latest), sample => sample.cpu)
	const storageUsed = Option.flatMap(Option.fromUndefinedOr(latest), sample => sample.storageUsed)
	const total = Number.sumAll(Array.map(props.history.disks, disk => disk.total))
	const disk = Array.map(props.history.samples, sample =>
		Boolean.match(total > 0, {
			onFalse: () => 0,
			onTrue: () =>
				Number.clamp((Option.getOrElse(sample.storageUsed, () => 0) / total) * 100, {maximum: 100, minimum: 0})
		})
	)
	const charts: readonly {
		cover: boolean
		figure: string
		focus?: Band['id']
		format: (value: number) => string
		label: string
		layers: readonly ChartLayer[]
		recorded: (sample: Sample) => boolean
	}[] = [
		{
			cover: false,
			figure: Boolean.match(latest === undefined, {onFalse: () => bytesOf(latest?.memoryUsed ?? 0), onTrue: () => '—'}),
			focus,
			format: bytesOf,
			label: 'Memory',
			layers: Array.map(all, band => ({...band, readings: band.memoryBytes, values: band.memory})),
			recorded: Function.constTrue
		},
		{
			cover: false,
			figure: Option.match(cpu, {onNone: () => '—', onSome: percentOf}),
			focus,
			format: percentOf,
			label: 'CPU',
			layers: Array.map(all, band => ({...band, readings: band.cpu, values: band.cpu})),
			recorded: sample => Option.isSome(sample.cpu)
		},
		{
			cover: true,
			figure: Option.match(storageUsed, {
				onNone: () => '—',
				onSome: used =>
					Boolean.match(total > 0, {onFalse: () => '—', onTrue: () => percentOf(Number.round((used / total) * 100, 0))})
			}),
			format: percentOf,
			label: 'Disk',
			layers: [{id: 'disk', kind: 'disk', opacity: 1, readings: disk, values: disk}],
			recorded: sample => Option.isSome(sample.storageUsed)
		}
	]
	return (
		<div className="flex shrink-0 flex-col border-b">
			{Boolean.match(props.isPhone, {
				onFalse: () => (
					<div className="grid h-8 shrink-0 grid-cols-3 items-center gap-6 border-b px-4">
						{Array.map(charts, chart => (
							<ChartTitle key={chart.label} figure={chart.figure} label={chart.label} />
						))}
					</div>
				),
				onTrue: Function.constNull
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(charts, (chart, index) => (
					<div key={chart.label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: Function.constNull,
							onTrue: () => (
								<div className="flex h-8 items-center border-b">
									<ChartTitle figure={chart.figure} label={chart.label} />
								</div>
							)
						})}
						<UsageChart
							className="h-16 sm:h-32"
							cover={chart.cover}
							focus={chart.focus}
							format={chart.format}
							history={props.history}
							label={chart.label}
							layers={chart.layers}
							minutes={props.minutes}
							names={id => {
								if (id === 'disk') return 'Disk'
								return bandName(id, props.labels)
							}}
							recorded={chart.recorded}
						/>
						{Boolean.match(props.isPhone, {
							onFalse: () => <TimeAxis minutes={props.minutes} now={props.history.time} />,
							onTrue: () =>
								Boolean.match(index === charts.length - 1, {
									onFalse: Function.constNull,
									onTrue: () => <TimeAxis minutes={props.minutes} now={props.history.time} />
								})
						})}
					</div>
				))}
			</div>
		</div>
	)
}

export function EmptyChart(props: {worker?: string}) {
	return (
		<div className="flex h-44 shrink-0 items-center justify-center sm:h-64">
			<EmptyState
				icon={<ChartLineIcon weight="light" />}
				label={Boolean.match(props.worker === undefined, {
					onFalse: () => 'No readings in this range',
					onTrue: () => 'No machine'
				})}
			/>
		</div>
	)
}
