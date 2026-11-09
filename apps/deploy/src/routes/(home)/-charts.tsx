import {Array, Boolean, Match, Number, Option, String, pipe} from 'effect'

import {useState} from 'react'

import {cn} from '@deslop/components-web/utils'

import {chartTicks} from '#routes/(home)/-chart.ts'
import {runs} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const HEIGHT = 64
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})
const formatPercent = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

// A run of one sample still gets a slot's width, so a lone reading shows.
function widen(run: readonly {index: number; x: number}[]) {
	if (run.length !== 1) return run
	return [{index: run[0]?.index ?? 0, x: (run[0]?.x ?? 0) - 100 / 60}, ...run]
}

function y(percent: number, height: number) {
	return height - (Number.clamp(percent, {maximum: 100, minimum: 0}) / 100) * height
}

// The machine's share each band holds over time, stacked on the whole machine's 0–100% so the height alone says how loaded it is.
export function UsageChart(props: {
	className?: string
	history: MachineHistory
	minutes: number
	hovered?: string
	label: string
	layers: readonly {id: string; kind: Band['kind']; opacity: number; values: readonly number[]}[]
	names: (id: string) => string
	onHover: (id?: string) => void
	recorded: (sample: Sample) => boolean
	value?: string
}) {
	const [pointer, setPointer] = useState<number>()
	const window = chartWindow(props.minutes, props.history.time)
	const pointerSample = Option.flatMap(Option.fromUndefinedOr(pointer), index =>
		Option.map(Array.get(props.history.samples, index), sample => ({index, sample}))
	)
	const hoveredBand = Option.flatMap(Option.fromUndefinedOr(props.hovered), id =>
		Array.findFirst(props.layers, layer => layer.id === id)
	)
	const valueText = Option.getOrElse(
		Option.map(pointerSample, point => {
			const total = Number.sumAll(Array.map(props.layers, layer => layer.values[point.index] ?? 0))
			const value = Option.map(hoveredBand, band => band.values[point.index] ?? 0)
			const at = pipe(
				Match.value(props.minutes),
				Match.when(10_080, () => date.format(point.sample.time)),
				Match.orElse(() => time.format(point.sample.time))
			)
			return Option.match(value, {
				onNone: () => `${at} · ${formatPercent.format(total)}% total`,
				onSome: current =>
					`${at} · ${props.names(props.hovered ?? '')} ${formatPercent.format(current)}% (${formatPercent.format(Boolean.match(total === 0, {onFalse: () => (current / total) * 100, onTrue: () => 0}))}%) · ${formatPercent.format(total)}% total`
			})
		}),
		() => props.value ?? ''
	)
	return (
		<figure className={cn('flex min-h-0 flex-col', props.className)} aria-label={props.label}>
			<figcaption className="text-2xs mb-1 flex items-baseline justify-between gap-2 font-mono">
				<span className="tracking-label font-medium uppercase">{props.label}</span>
				<span className="text-muted-foreground text-2xs min-w-0 truncate font-mono tabular-nums" title={valueText}>
					{valueText}
				</span>
			</figcaption>
			<div className="flex min-h-0 flex-1">
				<div className="min-h-0 flex-1">
					<svg
						viewBox={`0 0 100 ${HEIGHT}`}
						preserveAspectRatio="none"
						className="size-full overflow-visible"
						role="img"
						aria-label={`${props.label} over time; blank time is unrecorded`}
						onPointerMove={event => {
							const at =
								window.start +
								((event.clientX - event.currentTarget.getBoundingClientRect().left) /
									event.currentTarget.getBoundingClientRect().width) *
									(window.end - window.start)
							setPointer(
								Option.getOrUndefined(Array.findFirstIndex(props.history.samples, sample => sample.time >= at))
							)
						}}
						onPointerLeave={() => setPointer(undefined)}
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
								const lit = props.hovered === undefined || props.hovered === layer.band.id
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
										fill={Boolean.match(layer.band.kind === 'app', {
											onFalse: () => 'var(--muted-foreground)',
											onTrue: () => 'var(--machine)'
										})}
										fillOpacity={Boolean.match(lit, {
											onFalse: () => layer.band.opacity * 0.25,
											onTrue: () =>
												Boolean.match(props.hovered === undefined, {
													onFalse: () => Number.max(0.85, layer.band.opacity),
													onTrue: () => layer.band.opacity
												})
										})}
										stroke="var(--background)"
										strokeWidth="0.6"
										vectorEffect="non-scaling-stroke"
										onPointerEnter={() => props.onHover(layer.band.id)}
										onPointerLeave={() => props.onHover()}
									>
										<title>{props.names(layer.band.id)}</title>
									</polygon>
								))
							}
						)}
						{Option.match(pointerSample, {
							onNone: () => null,
							onSome: point => {
								const x = ((point.sample.time - window.start) / (window.end - window.start)) * 100
								return (
									<line
										x1={x}
										x2={x}
										y1="0"
										y2={HEIGHT}
										stroke="var(--foreground)"
										strokeOpacity="0.35"
										vectorEffect="non-scaling-stroke"
									/>
								)
							}
						})}
						<line x1="0" x2="100" y1={HEIGHT} y2={HEIGHT} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
					</svg>
				</div>
			</div>
		</figure>
	)
}

// Each core's use across the range as a small line, so a core that spiked or idled reads in its history, not only its last reading.
export function Cores(props: {history: MachineHistory}) {
	const samples = Array.map(props.history.samples, sample => Array.groupBy(sample.cores ?? [], core => core.id))
	return (
		<figure className="flex flex-col" aria-label="Cores">
			<figcaption className="tracking-label text-muted-foreground text-2xs mb-1 font-mono font-medium uppercase">
				Cores
			</figcaption>
			{Array.match(Option.getOrUndefined(Array.last(props.history.samples))?.cores ?? [], {
				onEmpty: () => <span className="text-muted-foreground text-2xs font-mono">No readings</span>,
				onNonEmpty: entries => (
					<div
						className="grid grid-cols-(--cores) items-end gap-1"
						style={{'--cores': `repeat(${Number.min(32, Number.max(1, entries.length))}, minmax(0, 1fr))`}}
					>
						{Array.map(entries, core => {
							const values = Array.map(samples, cores =>
								Option.getOrElse(
									Option.map(Array.head(cores[core.id] ?? []), entry => entry.usage ?? 0),
									() => 0
								)
							)
							const points = Array.map(
								values,
								(value, index) =>
									`${(index / Number.max(1, values.length - 1)) * 100},${100 - Number.clamp(value, {maximum: 100, minimum: 0})}`
							)
							return (
								<svg
									key={core.id}
									role="img"
									aria-label={`${core.id} use ${formatPercent.format(core.usage ?? 0)} percent`}
									viewBox="0 0 100 100"
									preserveAspectRatio="none"
									className="h-3 w-full text-(--machine)"
								>
									<title>{`${core.id} · ${formatPercent.format(core.usage ?? 0)}%`}</title>
									<polyline
										points={Array.join(points, ' ')}
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										vectorEffect="non-scaling-stroke"
									/>
								</svg>
							)
						})}
					</div>
				)
			})}
		</figure>
	)
}

// Clock-aligned times under the machine's time charts, shared by each of them.
export function TimeAxis(props: {history: MachineHistory; minutes: number}) {
	return (
		<div aria-hidden="true">
			<svg width="100%" height="14" className="text-muted-foreground text-2xs overflow-visible font-mono tabular-nums">
				{Array.map(
					Array.filter(chartTicks(props.minutes, props.history.time), tick => tick.label),
					tick => (
						<text
							key={tick.at}
							x={`${tick.x}%`}
							y="10"
							textAnchor={Boolean.match(tick.x < 8, {
								onFalse: () => Boolean.match(tick.x > 92, {onFalse: () => 'middle', onTrue: () => 'end'}),
								onTrue: () => 'start'
							})}
							fill="currentColor"
						>
							{pipe(
								Match.value(props.minutes),
								// A minute reads as the minute, then its quarters as seconds, so four labels fit a phone.
								Match.when(1, () =>
									Boolean.match(tick.at % 60_000 === 0, {
										onFalse: () => `:${String.padStart(2, '0')(`${(tick.at % 60_000) / 1000}`)}`,
										onTrue: () => time.format(tick.at)
									})
								),
								Match.when(10_080, () => date.format(tick.at)),
								Match.orElse(() => time.format(tick.at))
							)}
						</text>
					)
				)}
			</svg>
		</div>
	)
}
