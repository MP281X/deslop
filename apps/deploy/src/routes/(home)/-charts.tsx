import {Array, Boolean, DateTime, Match, Number, Option, String, pipe, type Record} from 'effect'

import {ChartLineIcon} from '@phosphor-icons/react'
import {useState} from 'react'
import type {PointerEvent} from 'react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@deslop/components-web/ui/tooltip'
import {cn} from '@deslop/components-web/utils'

import {chartTicks} from '#routes/(home)/-chart.ts'
import {bandName, bytes, rate} from '#routes/(home)/-rows.ts'
import {appHue, bands, runs} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import {chartWindow, usedStorage} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const HEIGHT = 64
const CHART_LABELS = ['Memory', 'CPU', 'Disk'] as const
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})

// One stacked band: its share at each sample, and the number its tooltip names, in bytes or per cent.
type ChartLayer = {
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
function UsageChart(props: {
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
								const fill = fillOf(layer.band, props.names(layer.band.id), props.hue)
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
function TimeAxis(props: {className?: string; minutes: number; now: number}) {
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
	const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
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
				onTrue: () => null
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(CHART_LABELS, (label, index) => (
					<div key={label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: () => null,
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
									onFalse: () => null,
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
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
}) {
	const all = bands(props.history)
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	const total = Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.total)
	const disk = Array.map(props.history.samples, sample =>
		Boolean.match(total > 0, {
			onFalse: () => 0,
			onTrue: () => Number.clamp((usedStorage(sample) / total) * 100, {maximum: 100, minimum: 0})
		})
	)
	const charts: readonly {
		cover: boolean
		figure: string
		format: (value: number) => string
		label: string
		layers: readonly ChartLayer[]
		recorded: (sample: Sample) => boolean
	}[] = [
		{
			cover: false,
			figure: Boolean.match(latest === undefined, {onFalse: () => bytes(latest?.memoryUsed ?? 0), onTrue: () => '—'}),
			format: bytes,
			label: 'Memory',
			layers: Array.map(all, band => ({...band, readings: band.memoryBytes, values: band.memory})),
			recorded: () => true
		},
		{
			cover: false,
			figure: Boolean.match(latest?.cpu === undefined, {onFalse: () => rate(latest?.cpu ?? 0), onTrue: () => '—'}),
			format: rate,
			label: 'CPU',
			layers: Array.map(all, band => ({...band, readings: band.cpu, values: band.cpu})),
			recorded: sample => sample.cpu !== undefined
		},
		{
			cover: true,
			figure: Option.match(Option.fromUndefinedOr(latest), {
				onNone: () => '—',
				onSome: sample =>
					Boolean.match(total > 0, {
						onFalse: () => '—',
						onTrue: () => `${Number.round((usedStorage(sample) / total) * 100, 0)}%`
					})
			}),
			format: rate,
			label: 'Disk',
			layers: [{id: 'disk', kind: 'disk', opacity: 1, readings: disk, values: disk}],
			recorded: sample => sample.storageUsed !== undefined || Array.isReadonlyArrayNonEmpty(sample.disks)
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
				onTrue: () => null
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(charts, (chart, index) => (
					<div key={chart.label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: () => null,
							onTrue: () => (
								<div className="flex h-8 items-center border-b">
									<ChartTitle figure={chart.figure} label={chart.label} />
								</div>
							)
						})}
						<UsageChart
							className="h-16 sm:h-32"
							cover={chart.cover}
							format={chart.format}
							history={props.history}
							hue={appHue}
							label={chart.label}
							layers={chart.layers}
							minutes={props.minutes}
							names={id =>
								Boolean.match(chart.label === 'Disk', {onFalse: () => bandName(id, props.labels), onTrue: () => 'Disk'})
							}
							recorded={chart.recorded}
						/>
						{Boolean.match(props.isPhone, {
							onFalse: () => <TimeAxis minutes={props.minutes} now={props.history.time} />,
							onTrue: () =>
								Boolean.match(index === charts.length - 1, {
									onFalse: () => null,
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
