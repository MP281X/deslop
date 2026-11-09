import {Array, Boolean, Match, Number, Option, String, pipe} from 'effect'

import {cn} from '@deslop/components-web/utils'

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

// A band's colour: a Deslop app in its icon's hue, a service without one a zinc step, small apps and the rest two darker greys.
function fillOf(
	band: {kind: Band['kind']; opacity: number},
	name: string,
	hue: (name: string) => Option.Option<string>
) {
	if (band.kind === 'other') return {color: 'var(--input)', opacity: 1}
	if (band.kind === 'system') return {color: 'var(--muted)', opacity: 1}
	return Option.match(hue(name), {
		onNone: () => ({color: 'var(--muted-foreground)', opacity: band.opacity}),
		onSome: color => ({color, opacity: 0.9})
	})
}

// The machine's share each band holds over time, stacked on the whole machine's 0–100% so the height alone says how loaded it is.
export function UsageChart(props: {
	className?: string
	highlight?: string
	history: MachineHistory
	hue: (name: string) => Option.Option<string>
	label: string
	layers: readonly {id: string; kind: Band['kind']; opacity: number; values: readonly number[]}[]
	minutes: number
	names: (id: string) => string
	onHover: (id?: string) => void
	recorded: (sample: Sample) => boolean
}) {
	return (
		<figure className={cn('flex min-h-0 flex-col', props.className)} aria-label={props.label}>
			<svg
				viewBox={`0 0 100 ${HEIGHT}`}
				preserveAspectRatio="none"
				className="size-full overflow-visible"
				role="img"
				aria-label={`${props.label} over time; blank time is unrecorded`}
				onPointerLeave={() => props.onHover()}
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
						const lit = props.highlight === undefined || props.highlight === layer.band.id
						const fill = fillOf(layer.band, props.names(layer.band.id), props.hue)
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
								fill={fill.color}
								fillOpacity={Boolean.match(lit, {onFalse: () => fill.opacity * 0.3, onTrue: () => fill.opacity})}
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

// Clock-aligned times under the machine's time chart, real while the chart loads.
export function TimeAxis(props: {minutes: number; now: number}) {
	return (
		<div aria-hidden="true">
			<svg width="100%" height="16" className="text-muted-foreground overflow-visible font-mono text-xs tabular-nums">
				{Array.map(
					Array.filter(chartTicks(props.minutes, props.now), tick => tick.label),
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
						</text>
					)
				)}
			</svg>
		</div>
	)
}
