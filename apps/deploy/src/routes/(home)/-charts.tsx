import {Array, Boolean, Match, Number, Option, String, pipe} from 'effect'

import {chartTicks} from '#routes/(home)/-chart.ts'
import {runs} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const HEIGHT = 64
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})

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
	history: MachineHistory
	minutes: number
	hovered?: string
	label: string
	layers: readonly {id: string; kind: Band['kind']; opacity: number; values: readonly number[]}[]
	names: (id: string) => string
	onHover: (id?: string) => void
	recorded: (sample: Sample) => boolean
}) {
	return (
		<figure className="flex min-h-0 flex-1 flex-col" aria-label={props.label}>
			<figcaption className="text-muted-foreground mb-1 text-xs">{props.label}</figcaption>
			<svg
				viewBox={`0 0 100 ${HEIGHT}`}
				preserveAspectRatio="none"
				className="min-h-0 w-full flex-1 overflow-visible"
				role="img"
				aria-label={`${props.label} over time; blank time is unrecorded`}
			>
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
										...Array.map(Array.reverse(run), point => `${point.x},${y(layer.bottom[point.index] ?? 0, HEIGHT)}`)
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
				<line x1="0" x2="100" y1={HEIGHT} y2={HEIGHT} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
			</svg>
		</figure>
	)
}

// Each core's own use over time, 0–100%, as a line per core across the machine's width: four to a row on a phone, all in one row from there up to 16.
export function Cores(props: {history: MachineHistory; minutes: number}) {
	const cores = Option.getOrUndefined(Array.last(props.history.samples))?.cores ?? []
	return (
		<figure className="flex flex-col" aria-label="Cores">
			<figcaption className="text-muted-foreground mb-1 text-xs">Cores</figcaption>
			<div
				className="grid grid-cols-4 gap-1.5 sm:grid-cols-(--cores)"
				style={{'--cores': `repeat(${Number.min(16, Number.max(1, cores.length))}, minmax(0, 1fr))`}}
			>
				{Array.map(cores, core => (
					<div key={core.id} className="min-w-0">
						<svg
							viewBox="0 0 100 24"
							preserveAspectRatio="none"
							className="bg-muted h-6 w-full"
							role="img"
							aria-label={`${core.id} use over time`}
						>
							{Array.map(
								runs(props.history, props.minutes, sample =>
									Array.some(sample.cores ?? [], entry => entry.id === core.id && entry.usage !== undefined)
								),
								run => (
									<polyline
										key={run[0].x}
										points={Array.join(
											Array.map(widen(run), point => {
												const usage = Option.flatMap(
													Array.findFirst(
														props.history.samples[point.index]?.cores ?? [],
														entry => entry.id === core.id
													),
													entry => Option.fromUndefinedOr(entry.usage)
												)
												return `${point.x},${y(
													Option.getOrElse(usage, () => 0),
													24
												)}`
											}),
											' '
										)}
										fill="none"
										stroke="var(--machine)"
										strokeWidth="1.2"
										vectorEffect="non-scaling-stroke"
									/>
								)
							)}
						</svg>
					</div>
				))}
			</div>
		</figure>
	)
}

// Clock-aligned times under the machine's time charts, shared by each of them.
export function TimeAxis(props: {history: MachineHistory; minutes: number}) {
	return (
		<div aria-hidden="true">
			<svg width="100%" height="16" className="text-muted-foreground overflow-visible font-mono text-xs tabular-nums">
				{Array.map(
					Array.filter(chartTicks(props.minutes, props.history.time), tick => tick.label),
					tick => (
						<text
							key={tick.at}
							x={`${tick.x}%`}
							y="12"
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
