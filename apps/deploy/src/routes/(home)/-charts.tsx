import {useAtomValue} from '@effect/atom-react'

import type {Duration} from 'effect'
import {Array, Boolean, DateTime, Function, Number, Option, Record, Schema, pipe} from 'effect'

import {ChartLineIcon} from '@phosphor-icons/react'
import {useState} from 'react'
import {Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis} from 'recharts'

import {Sparkline} from '@deslop/components-web/blocks/sparkline'
import {cn} from '@deslop/components-web/lib/utils'
import {ChartContainer, ChartTooltip, ChartTooltipContent} from '@deslop/components-web/ui/chart'
import type {ChartConfig} from '@deslop/components-web/ui/chart'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {clockAtom} from '@deslop/runtime/client/clock'
import {bytesOf, clockOf, dayOf, percentOf} from '@deslop/runtime/shared/format'

import {chartTicks, datedRange, spacedTicks} from '#routes/(home)/-chart.ts'
import {bandFill, chartPoints, focusedBand} from '#routes/(home)/-usage.ts'
import type {Band, BandFillKind, Usage} from '#routes/(home)/-usage.ts'
import type {AppId} from '#services/inventory/schema.ts'
import {bandName, chartWindow} from '#services/metrics/lib/utils.ts'
import {BandId} from '#services/metrics/schema.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const CHART_LABELS = ['Memory', 'CPU', 'Disk'] as const

type ChartLayerId = typeof ChartLayerId.Type
const ChartLayerId = Schema.Union([BandId, Schema.Literal('disk')])

type HoveredPoint = typeof HoveredPoint.Type
// The hovered point as the chart hands it back, untyped: its time and its sample.
const HoveredPoint = Schema.Struct({at: Schema.Finite, index: Schema.Finite})

// One stacked band: its share at each sample, and the number its tooltip names, in bytes or per cent.
type ChartLayer = {
	kind: BandFillKind
	id: ChartLayerId
	opacity: number
	readings: readonly number[]
	values: readonly number[]
}

// The machine's share each band holds over time, stacked on the whole machine's 0–100%; blank time is unrecorded. The tooltip names every band's reading at the hovered time, and a selected app's band stands out.
function UsageChart(props: {
	className?: string
	focus: Option.Option<Band['id']>
	format: (value: number) => string
	history: MachineHistory
	label: string
	layers: readonly ChartLayer[]
	minutes: Duration.Duration
	names: (id: ChartLayer['id']) => string
	recorded: (sample: Sample) => boolean
}) {
	const window = chartWindow(props.minutes, props.history.time)
	const config = Record.fromEntries(
		Array.map(props.layers, (layer, index) => [
			`band${index}`,
			{color: bandFill(layer.kind, layer.opacity).color, label: props.names(layer.id)}
		])
	) satisfies ChartConfig
	const focused = props.focus
	return (
		<figure className={cn('flex min-h-0', props.className)} aria-label={props.label}>
			<ChartContainer config={config} className="min-w-0 flex-1">
				{/* The drawing is one Tab stop, named by its title; arrow keys move the tooltip between its points. */}
				<AreaChart
					title={`${props.label} over time; blank time is unrecorded`}
					data={chartPoints(props.history, props.minutes, props.recorded, props.layers)}
					margin={{bottom: 0, left: 0, right: 0, top: 0}}
				>
					{/* Grid lines only at the ticks, never at the chart's edges. */}
					<CartesianGrid horizontal={false} syncWithTicks />
					{/* Every tick keeps its grid line: the hidden axis would otherwise drop ticks whose unshown labels overlap. */}
					<XAxis
						hide
						interval={0}
						dataKey="at"
						type="number"
						domain={[DateTime.toEpochMillis(window.start), DateTime.toEpochMillis(window.end)]}
						ticks={Array.map(chartTicks(props.minutes, props.history.time, DateTime.zoneMakeLocal()), tick => tick.at)}
					/>
					<YAxis hide allowDataOverflow domain={[0, 100]} />
					<ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
					<ReferenceLine y={0} stroke="var(--border)" />
					<ChartTooltip
						isAnimationActive={false}
						content={
							<ChartTooltipContent
								labelFormatter={(_, points) =>
									pipe(
										Array.head(points),
										Option.flatMap(point => Schema.decodeUnknownOption(HoveredPoint)(point.payload)),
										Option.match({
											onNone: Function.constant(''),
											onSome: point => clockOf(DateTime.makeUnsafe(point.at))
										})
									)
								}
								formatter={(_value, name, item) =>
									pipe(
										Option.fromUndefinedOr(name),
										Option.flatMap(key => Array.findFirst(props.layers, (_, index) => `band${index}` === key)),
										Option.match({
											onNone: Function.constNull,
											onSome: layer => (
												<>
													<span className="text-muted-foreground">{props.names(layer.id)}</span>
													<span className="ms-auto font-mono tabular-nums">
														{pipe(
															Schema.decodeUnknownOption(HoveredPoint)(item.payload),
															Option.flatMap(point => Array.get(layer.readings, point.index)),
															Option.match({onNone: Function.constant('—'), onSome: props.format})
														)}
													</span>
												</>
											)
										})
									)
								}
							/>
						}
					/>
					{Array.map(props.layers, (layer, index) => {
						const fill = bandFill(layer.kind, layer.opacity)
						const isFocused = Option.contains(focused, layer.id)
						return (
							<Area
								key={layer.id}
								dataKey={`band${index}`}
								stackId="usage"
								type="linear"
								isAnimationActive={false}
								activeDot={false}
								fill={`var(--color-band${index})`}
								fillOpacity={Boolean.match(Option.isSome(focused) && !isFocused, {
									onFalse: () =>
										Boolean.match(isFocused, {
											onFalse: () => fill.opacity,
											onTrue: () => Number.max(fill.opacity, 0.9)
										}),
									onTrue: () => fill.opacity * 0.15
								})}
								stroke={Boolean.match(isFocused, {
									onFalse: Function.constant('var(--background)'),
									onTrue: Function.constant('var(--foreground)')
								})}
								strokeWidth={1}
							/>
						)
					})}
				</AreaChart>
			</ChartContainer>
		</figure>
	)
}

// HTML time labels under a chart, so they keep their shape whatever the chart's scale; clock-aligned ticks match the grid, and a label that would crowd the one before it is left out.
function TimeAxis(props: {className?: string; minutes: Duration.Duration; now: DateTime.Utc}) {
	const [width, setWidth] = useState(0)
	function measureAxis(element: HTMLDivElement) {
		const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width))
		observer.observe(element)
		return () => {
			observer.disconnect()
		}
	}
	return (
		<div
			ref={measureAxis}
			aria-hidden="true"
			className={cn('text-muted-foreground relative h-4 font-mono text-xs tabular-nums', props.className)}
		>
			{pipe(
				chartTicks(props.minutes, props.now, DateTime.zoneMakeLocal()),
				Array.filter(tick => tick.label),
				Array.map(tick => ({
					...tick,
					text: Boolean.match(datedRange(props.minutes), {
						onFalse: () => clockOf(DateTime.makeUnsafe(tick.at)),
						onTrue: () => dayOf(DateTime.makeUnsafe(tick.at), props.now)
					})
				})),
				spacedTicks(width),
				Array.map(tick => (
					<span
						key={tick.at}
						className={cn(
							'absolute top-0 left-(--tick-x) whitespace-nowrap',
							Boolean.match(tick.x < 8, {
								onFalse: () =>
									Boolean.match(tick.x > 92, {
										onFalse: Function.constant('-translate-x-1/2'),
										onTrue: Function.constant('-translate-x-full')
									}),
								onTrue: Function.constant('')
							})
						)}
						style={{'--tick-x': `${tick.x}%`}}
					>
						{tick.text}
					</span>
				))
			)}
		</div>
	)
}

// One loading chart title: its static name, with only the server's figure left to load.
function ChartTitleSkeleton(props: {label: string}) {
	return (
		<div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs">
			<span className="truncate">{props.label}</span>
			<Skeleton className="h-4 w-10 shrink-0" />
		</div>
	)
}

export function ChartSkeleton(props: {minutes: HistoryQuery['minutes']}) {
	const now = useAtomValue(clockAtom('1 minute'))
	return (
		<div aria-busy="true" aria-label="Usage history" role="status" className="flex shrink-0 flex-col border-b">
			<div className="grid h-8 grid-cols-3 items-center gap-6 border-b px-2">
				{Array.map(CHART_LABELS, label => (
					<ChartTitleSkeleton key={label} label={label} />
				))}
			</div>
			<div className="grid grid-cols-3 gap-6 px-2 py-3">
				{Array.map(CHART_LABELS, label => (
					<div key={label} className="flex min-w-0 flex-col gap-1">
						<Skeleton className="h-32 w-full" />
						<TimeAxis minutes={props.minutes} now={now} />
					</div>
				))}
			</div>
		</div>
	)
}

// The figure keeps its width; a column too narrow for both cuts the name.
function ChartTitle(props: {figure: string; label: string}) {
	return (
		<div className="flex w-full min-w-0 items-baseline justify-between gap-2 text-xs">
			<span className="truncate">{props.label}</span>
			<span className="shrink-0 tabular-nums">{props.figure}</span>
		</div>
	)
}

// The latest sample's three figures, a dash where it has no reading, and each reading's share of the machine over the range.
function readingsOf(history: MachineHistory) {
	const latest = Array.last(history.samples)
	const total = Number.sumAll(Array.map(history.disks, disk => disk.total))
	const disk = Array.map(history.samples, sample =>
		Boolean.match(total > 0, {
			onFalse: Function.constant(0),
			onTrue: () =>
				Number.clamp((Option.getOrElse(sample.storageUsed, Function.constant(0)) / total) * 100, {
					maximum: 100,
					minimum: 0
				})
		})
	)
	return {
		cpu: {
			figure: pipe(
				latest,
				Option.flatMap(sample => sample.cpu),
				Option.match({onNone: Function.constant('—'), onSome: percentOf})
			),
			series: Array.map(history.samples, sample => Option.getOrElse(sample.cpu, Function.constant(0)))
		},
		disk: {
			figure: pipe(
				latest,
				Option.flatMap(sample => sample.storageUsed),
				Option.filter(() => total > 0),
				Option.match({onNone: Function.constant('—'), onSome: used => percentOf(Number.round((used / total) * 100, 0))})
			),
			series: disk,
			total
		},
		memory: {
			figure: Option.match(latest, {onNone: Function.constant('—'), onSome: sample => bytesOf(sample.memoryUsed)}),
			series: Array.map(history.samples, sample => (sample.memoryUsed / Number.max(1, sample.memoryTotal)) * 100)
		}
	}
}

// The machine's three readings over time: apps stacked on the whole machine's 0–100%, and disk used as one band.
export function ChartBlock(props: {
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	selectedOwner: Option.Option<AppId>
	usage: Usage
}) {
	const focus = Option.flatMap(props.selectedOwner, selected => focusedBand(props.usage, selected))
	const readings = readingsOf(props.usage.history)
	const charts: readonly {
		figure: string
		focus: Option.Option<Band['id']>
		format: (value: number) => string
		label: string
		layers: readonly ChartLayer[]
		recorded: (sample: Sample) => boolean
	}[] = [
		{
			figure: readings.memory.figure,
			focus,
			format: bytesOf,
			label: 'Memory',
			layers: Array.map(props.usage.bands, band => ({...band, readings: band.memoryBytes, values: band.memory})),
			recorded: Function.constTrue
		},
		{
			figure: readings.cpu.figure,
			focus,
			format: percentOf,
			label: 'CPU',
			layers: Array.map(props.usage.bands, band => ({...band, readings: band.cpu, values: band.cpu})),
			recorded: sample => Option.isSome(sample.cpu)
		},
		{
			figure: readings.disk.figure,
			focus: Option.none(),
			format: percentOf,
			label: 'Disk',
			layers: [{id: 'disk', kind: 'disk', opacity: 1, readings: readings.disk.series, values: readings.disk.series}],
			recorded: sample => readings.disk.total > 0 && Option.isSome(sample.storageUsed)
		}
	]
	return (
		<div className="flex shrink-0 flex-col border-b">
			<div className="grid h-8 shrink-0 grid-cols-3 items-center gap-6 border-b px-2">
				{Array.map(charts, chart => (
					<ChartTitle key={chart.label} figure={chart.figure} label={chart.label} />
				))}
			</div>
			<div className="grid grid-cols-3 gap-6 px-2 py-3">
				{Array.map(charts, chart => (
					<div key={chart.label} className="flex min-w-0 flex-col gap-1">
						<UsageChart
							className="h-32"
							focus={chart.focus}
							format={chart.format}
							history={props.usage.history}
							label={chart.label}
							layers={chart.layers}
							minutes={props.minutes}
							names={id => {
								if (id === 'disk') return 'Disk'
								return bandName(id, props.labels)
							}}
							recorded={chart.recorded}
						/>
						<TimeAxis minutes={props.minutes} now={props.usage.history.time} />
					</div>
				))}
			</div>
		</div>
	)
}

// A phone's readings in one row above the list: each figure over its line for the range, so the list keeps the screen; the full charts need the width of a wider screen. A machine with no readings shows dashes and no lines.
export function ReadingStrip(props: {history: Option.Option<MachineHistory>}) {
	const readings = Option.map(props.history, readingsOf)
	return (
		<div aria-label="Usage" role="group" className="grid shrink-0 grid-cols-3 gap-4 border-b p-2">
			{Array.map(
				[
					{key: 'memory', label: 'Memory'},
					{key: 'cpu', label: 'CPU'},
					{key: 'disk', label: 'Disk'}
				] as const,
				metric => (
					<div key={metric.key} className="flex min-w-0 flex-col gap-1">
						<ChartTitle
							figure={Option.match(readings, {onNone: Function.constant('—'), onSome: all => all[metric.key].figure})}
							label={metric.label}
						/>
						{Option.match(readings, {
							onNone: () => <div className="h-4" />,
							onSome: all => <Sparkline className="h-4 w-full" max={100} values={all[metric.key].series} />
						})}
					</div>
				)
			)}
		</div>
	)
}

// The strip while the readings load, in its own shape.
export function ReadingStripSkeleton() {
	return (
		<div aria-busy="true" aria-label="Usage" role="status" className="grid shrink-0 grid-cols-3 gap-4 border-b p-2">
			{Array.map(CHART_LABELS, label => (
				<div key={label} className="flex min-w-0 flex-col gap-1">
					<ChartTitleSkeleton label={label} />
					<Skeleton className="h-4 w-full" />
				</div>
			))}
		</div>
	)
}

export function EmptyChart() {
	return (
		<div className="flex h-64 shrink-0 items-center justify-center">
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ChartLineIcon />
					</EmptyMedia>
					<EmptyTitle>No readings</EmptyTitle>
				</EmptyHeader>
			</Empty>
		</div>
	)
}
