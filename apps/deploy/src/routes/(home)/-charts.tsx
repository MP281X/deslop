import {Array, Boolean, DateTime, Duration, Function, Match, Number, Option, Record, Schema, String, pipe} from 'effect'

import {ChartLineIcon} from '@phosphor-icons/react'
import {Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis} from 'recharts'

import {cn} from '@deslop/components-web/lib/utils'
import {ChartContainer, ChartTooltip, ChartTooltipContent} from '@deslop/components-web/ui/chart'
import type {ChartConfig} from '@deslop/components-web/ui/chart'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {bytesOf, clockOf, dayOf, percentOf} from '@deslop/runtime/shared/format'

import {chartTicks} from '#routes/(home)/-chart.ts'
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
	focus?: Band['id'] | undefined
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
	const focused = Option.fromUndefinedOr(props.focus)
	return (
		<figure className={cn('flex min-h-0', props.className)} aria-label={props.label}>
			<ChartContainer
				config={config}
				className="flex-1"
				role="img"
				aria-label={`${props.label} over time; blank time is unrecorded`}
			>
				<AreaChart
					data={chartPoints(props.history, props.minutes, props.recorded, props.layers)}
					margin={{bottom: 0, left: 0, right: 0, top: 0}}
				>
					<CartesianGrid horizontal={false} />
					<XAxis
						hide
						dataKey="at"
						type="number"
						domain={[DateTime.toEpochMillis(window.start), DateTime.toEpochMillis(window.end)]}
						ticks={Array.map(chartTicks(props.minutes, props.history.time), tick => tick.at)}
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
									Boolean.match(tick.x > 92, {
										onFalse: Function.constant('-translate-x-1/2'),
										onTrue: Function.constant('-translate-x-full')
									}),
								onTrue: Function.constant('')
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
					<div className="grid h-8 grid-cols-3 items-center gap-6 border-b px-2">
						{Array.map(CHART_LABELS, label => (
							<ChartTitleSkeleton key={label} label={label} />
						))}
					</div>
				),
				onTrue: Function.constNull
			})}
			<div className="grid grid-cols-1 gap-3 px-2 py-3 sm:grid-cols-3 sm:gap-6">
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
// judge-ignore no-silent-fallback -- a disk reading without a known disk size is unrecorded and plots nothing; numeric placeholders are never drawn as measurements, and absent figures show an em dash.
export function ChartBlock(props: {
	isPhone: boolean
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	selectedOwner?: AppId | undefined
	usage: Usage
}) {
	const history = props.usage.history
	const focus = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(props.selectedOwner), selected => focusedBand(props.usage, selected))
	)
	const latest = Option.getOrUndefined(Array.last(history.samples))
	const cpu = Option.flatMap(Option.fromUndefinedOr(latest), sample => sample.cpu)
	const storageUsed = Option.flatMap(Option.fromUndefinedOr(latest), sample => sample.storageUsed)
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
	const charts: readonly {
		figure: string
		focus?: Band['id'] | undefined
		format: (value: number) => string
		label: string
		layers: readonly ChartLayer[]
		recorded: (sample: Sample) => boolean
	}[] = [
		{
			figure: Boolean.match(latest === undefined, {
				onFalse: () => bytesOf(latest?.memoryUsed ?? 0),
				onTrue: Function.constant('—')
			}),
			focus,
			format: bytesOf,
			label: 'Memory',
			layers: Array.map(props.usage.bands, band => ({...band, readings: band.memoryBytes, values: band.memory})),
			recorded: Function.constTrue
		},
		{
			figure: Option.match(cpu, {onNone: Function.constant('—'), onSome: percentOf}),
			focus,
			format: percentOf,
			label: 'CPU',
			layers: Array.map(props.usage.bands, band => ({...band, readings: band.cpu, values: band.cpu})),
			recorded: sample => Option.isSome(sample.cpu)
		},
		{
			figure: Option.match(storageUsed, {
				onNone: Function.constant('—'),
				onSome: used =>
					Boolean.match(total > 0, {
						onFalse: Function.constant('—'),
						onTrue: () => percentOf(Number.round((used / total) * 100, 0))
					})
			}),
			format: percentOf,
			label: 'Disk',
			layers: [{id: 'disk', kind: 'disk', opacity: 1, readings: disk, values: disk}],
			recorded: sample => total > 0 && Option.isSome(sample.storageUsed)
		}
	]
	return (
		<div className="flex shrink-0 flex-col border-b">
			{Boolean.match(props.isPhone, {
				onFalse: () => (
					<div className="grid h-8 shrink-0 grid-cols-3 items-center gap-6 border-b px-2">
						{Array.map(charts, chart => (
							<ChartTitle key={chart.label} figure={chart.figure} label={chart.label} />
						))}
					</div>
				),
				onTrue: Function.constNull
			})}
			<div className="grid grid-cols-1 gap-3 px-2 py-3 sm:grid-cols-3 sm:gap-6">
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
							focus={chart.focus}
							format={chart.format}
							history={history}
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
							onFalse: () => <TimeAxis minutes={props.minutes} now={history.time} />,
							onTrue: () =>
								Boolean.match(index === charts.length - 1, {
									onFalse: Function.constNull,
									onTrue: () => <TimeAxis minutes={props.minutes} now={history.time} />
								})
						})}
					</div>
				))}
			</div>
		</div>
	)
}

export function EmptyChart(props: {worker?: string | undefined}) {
	return (
		<div className="flex h-44 shrink-0 items-center justify-center sm:h-64">
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ChartLineIcon />
					</EmptyMedia>
					<EmptyTitle>
						{Boolean.match(props.worker === undefined, {
							onFalse: Function.constant('No readings'),
							onTrue: Function.constant('No machine')
						})}
					</EmptyTitle>
				</EmptyHeader>
			</Empty>
		</div>
	)
}
