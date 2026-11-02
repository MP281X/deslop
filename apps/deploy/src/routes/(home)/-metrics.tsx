import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Number, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState, useTransition} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {machineName} from '#lib/components.tsx'
import {metricsAtom} from '#lib/utils.ts'
import {chartBucket, chartTicks, rateScale} from '#routes/(home)/-chart.ts'
import {chartWindow, resolution} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const numbers = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})
const stamp = new Intl.DateTimeFormat(undefined, {
	day: 'numeric',
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	month: 'short'
})

function size(value?: number) {
	if (value === undefined) return '—'
	if (value >= 1024 ** 3) return `${numbers.format(value / 1024 ** 3)} GiB`
	if (value >= 1024 ** 2) return `${numbers.format(value / 1024 ** 2)} MiB`
	return `${numbers.format(value / 1024)} KiB`
}

function Chart(props: {
	history: MachineHistory
	hours: number
	title: string
	value: (sample: Sample) => Sample['cpu']
	second?: (sample: Sample) => Sample['cpu']
}) {
	const window = chartWindow(props.hours, props.history.time)

	const scale = rateScale(
		Array.reduce(props.history.samples, 1, (max, sample) =>
			Number.max(max, Number.max(props.value(sample) ?? 0, props.second?.(sample) ?? 0))
		)
	)
	const maximum = Boolean.match(props.second === undefined, {onFalse: () => scale.maximum, onTrue: () => 100})
	const first = props.history.samples[0]
	const since = first?.since ?? first?.time ?? window.start
	const ticks = chartTicks(props.hours, props.history.time)
	return (
		<figure
			className="deploy-chart-grid mt-2 grid gap-x-2 gap-y-1"
			aria-label={`${props.history.worker} ${props.title} history`}
		>
			<svg
				width="100%"
				height="80"
				className="text-muted-foreground overflow-visible font-mono text-xs tabular-nums"
				aria-hidden="true"
			>
				{Array.map([8, 40, 72], (y, index) => (
					<text key={y} x="100%" y={y} textAnchor="end" dominantBaseline="middle" fill="currentColor">
						{Boolean.match(props.second === undefined, {
							onFalse: () => Boolean.match(index === 1, {onFalse: () => scale.label, onTrue: () => '0'}),
							onTrue: () => `${100 - index * 50}%`
						})}
					</text>
				))}
			</svg>
			<svg
				width="100%"
				height="80"
				className="overflow-hidden"
				role="img"
				aria-label={`${props.title}, ${props.hours} hours; blank time is unrecorded`}
			>
				{Array.map([8, 40, 72], y => (
					<line key={y} x1="0" x2="100%" y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
				))}
				{Array.map(ticks, tick => (
					<line key={tick.at} x1={`${tick.x}%`} x2={`${tick.x}%`} y1="8" y2="72" stroke="var(--border)" opacity="0.4" />
				))}
				{since > window.start + resolution(props.hours) && (
					<line
						x1={`${((since - window.start) / (window.end - window.start)) * 100}%`}
						x2={`${((since - window.start) / (window.end - window.start)) * 100}%`}
						y1="8"
						y2="72"
						stroke="var(--muted-foreground)"
						strokeDasharray="2 2"
					>
						<title>Recording starts {stamp.format(since)}</title>
					</line>
				)}
				{Array.map(props.history.samples, sample => {
					const bucket = chartBucket(props.hours, props.history.time, sample.time)
					const value = props.value(sample)
					const second = props.second?.(sample)
					const height =
						Number.clamp((value ?? 0) / maximum, {maximum: 1, minimum: 0}) *
						Boolean.match(props.second === undefined, {onFalse: () => 32, onTrue: () => 64})
					return (
						<g key={sample.time}>
							{value !== undefined && (
								<rect
									x={`${bucket.x}%`}
									y={Boolean.match(props.second === undefined, {onFalse: () => 40, onTrue: () => 72}) - height}
									width={`${bucket.width}%`}
									height={Number.max(0.5, height)}
									fill="var(--primary)"
								>
									<title>
										{time.format(sample.time)} · {numbers.format(value)}
										{Boolean.match(props.second === undefined, {onFalse: () => ' B/s', onTrue: () => '%'})}
									</title>
								</rect>
							)}
							{second !== undefined && (
								<rect
									x={`${bucket.x}%`}
									y="40"
									width={`${bucket.width}%`}
									height={Number.max(0.5, Number.clamp(second / maximum, {maximum: 1, minimum: 0}) * 32)}
									fill="var(--primary)"
									opacity="0.45"
								>
									<title>
										{time.format(sample.time)} · {size(second)}/s
									</title>
								</rect>
							)}
						</g>
					)
				})}
			</svg>
			<span />
			<svg
				width="100%"
				height="16"
				className="text-muted-foreground overflow-visible font-mono text-xs tabular-nums"
				aria-hidden="true"
			>
				{Array.map(
					Array.filter(ticks, tick => tick.label),
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
							{Boolean.match(props.hours === 168, {
								onFalse: () => time.format(tick.at),
								onTrue: () => date.format(tick.at)
							})}
						</text>
					)
				)}
			</svg>
		</figure>
	)
}

function Capacity(props: {
	label: string
	tracks: {capacity: number; parts: {label: string; value: number; opacity: number}[]}[]
}) {
	const total = Number.max(
		1,
		Array.reduce(props.tracks, 0, (sum, track) => sum + track.capacity)
	)
	const width = 100 - (props.tracks.length - 1)
	return (
		<div className="mt-3">
			<svg
				role="img"
				aria-label={props.label}
				viewBox="0 0 100 6"
				preserveAspectRatio="none"
				className="h-1.5 w-full overflow-hidden rounded-full"
			>
				{Array.map(props.tracks, (track, index) => {
					const x =
						(Array.reduce(Array.take(props.tracks, index), 0, (sum, previous) => sum + previous.capacity) / total) *
							width +
						index
					return (
						<g key={index}>
							<rect x={x} width={(track.capacity / total) * width} height="6" fill="var(--muted)" />
							{Array.map(track.parts, (part, partIndex) => (
								<rect
									key={part.label}
									x={
										x +
										(Array.reduce(Array.take(track.parts, partIndex), 0, (sum, previous) => sum + previous.value) /
											total) *
											width
									}
									width={(part.value / total) * width}
									height="6"
									fill="var(--primary)"
									opacity={part.opacity}
									stroke="var(--background)"
									strokeWidth="0.15"
								/>
							))}
						</g>
					)
				})}
			</svg>
			<div className="deploy-capacity-grid mt-2 grid items-center gap-x-2 gap-y-1 text-xs">
				{Array.flatMap(props.tracks, track =>
					Array.map(track.parts, part => (
						<div
							key={part.label}
							className="contents"
							title={`${part.label}: ${size(part.value)} of ${size(track.capacity)}`}
						>
							<svg viewBox="0 0 8 8" className="size-2">
								<rect width="8" height="8" fill="var(--primary)" opacity={part.opacity} />
							</svg>
							<span className="text-muted-foreground">{part.label}</span>
							<span className="text-right font-mono whitespace-nowrap tabular-nums">{size(part.value)}</span>
							<span className="text-muted-foreground text-right font-mono tabular-nums">
								{Number.round((part.value / Number.max(1, track.capacity)) * 100, 0)}%
							</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}

function Core(props: {id: string; usage?: number}) {
	return (
		<div className="deploy-core-grid grid items-center gap-2 font-mono text-xs">
			<span className="text-muted-foreground">{props.id}</span>
			<svg
				role="img"
				aria-label={`${props.id}: ${props.usage ?? 'unrecorded'}%`}
				viewBox="0 0 100 6"
				preserveAspectRatio="none"
				className="h-1.5 w-full overflow-hidden rounded-full"
			>
				<rect width="100" height="6" fill="var(--muted)" />
				<rect width={props.usage ?? 0} height="6" fill="var(--primary)" />
			</svg>
			<span className="text-right tabular-nums">
				{Boolean.match(props.usage === undefined, {
					onFalse: () => `${Number.round(props.usage ?? 0, 0)}%`,
					onTrue: () => '—'
				})}
			</span>
		</div>
	)
}

function Rates(props: {title: string; receive?: number; send?: number}) {
	return (
		<div className="flex h-5 items-center justify-between gap-2">
			<h3 className="text-sm font-medium">{props.title}</h3>
			<span className="flex items-center gap-2 font-mono text-xs whitespace-nowrap tabular-nums">
				<span className="flex items-center gap-1">
					<span className="bg-primary size-1.5" />↓ {size(props.receive)}/s
				</span>
				<span className="flex items-center gap-1">
					<span className="bg-primary/45 size-1.5" />↑ {size(props.send)}/s
				</span>
			</span>
		</div>
	)
}

function Machine(props: {history: MachineHistory; hours: HistoryQuery['hours']}) {
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	if (latest === undefined) return null
	const cached = Number.clamp(latest.memoryCached ?? 0, {
		maximum: Number.max(0, latest.memoryTotal - latest.memoryUsed),
		minimum: 0
	})
	const first = props.history.samples[0]
	const started = first?.since ?? first?.time ?? latest.time
	const storage = {
		total: Array.reduce(latest.disks, 0, (sum, disk) => sum + disk.total),
		used: Array.reduce(latest.disks, 0, (sum, disk) => sum + disk.used)
	}
	return (
		<section
			aria-label={`${props.history.worker} resource history`}
			className={`deploy-machine min-w-0 border-b pb-5 ${Boolean.match(props.history.stale, {onFalse: () => '', onTrue: () => 'opacity-50'})}`}
			data-machine={machineName(props.history.worker)}
		>
			<div className="grid min-w-0 grid-cols-1 items-start gap-x-8 gap-y-6 sm:grid-cols-2">
				<section className="min-w-0">
					<div className="flex h-5 items-center justify-between gap-2">
						<h3 className="text-sm font-medium">CPU</h3>
						<span className="font-mono text-xs whitespace-nowrap tabular-nums">
							{Boolean.match(latest.cpu === undefined, {
								onFalse: () => `${numbers.format(latest.cpu ?? 0)}%`,
								onTrue: () => '—'
							})}
						</span>
					</div>
					<Chart history={props.history} hours={props.hours} title="CPU" value={sample => sample.cpu} />
					<div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
						{Array.map(latest.cores ?? [], core => (
							<Core key={core.id} id={core.id} usage={core.usage} />
						))}
					</div>
				</section>
				<section className="min-w-0">
					<div className="flex h-5 items-center justify-between gap-2">
						<h3 className="text-sm font-medium">Memory</h3>
						<span className="font-mono text-xs whitespace-nowrap tabular-nums">{size(latest.memoryTotal)} RAM</span>
					</div>
					<Chart
						history={props.history}
						hours={props.hours}
						title="Memory"
						value={sample => (sample.memoryUsed / Number.max(1, sample.memoryTotal)) * 100}
					/>
					<Capacity
						label="RAM and swap capacity"
						tracks={[
							{
								capacity: latest.memoryTotal,
								parts: [
									{label: 'Used', opacity: 1, value: latest.memoryUsed},
									{label: 'Cache', opacity: 0.45, value: cached}
								]
							},
							...Boolean.match(latest.swapTotal > 0, {
								onFalse: () => [],
								onTrue: () => [
									{capacity: latest.swapTotal, parts: [{label: 'Swap', opacity: 1, value: latest.swapUsed}]}
								]
							})
						]}
					/>
				</section>
				<section className="min-w-0">
					<Rates title="Network" receive={latest.networkReceive} send={latest.networkSend} />
					<Chart
						history={props.history}
						hours={props.hours}
						title="Network"
						value={sample => sample.networkReceive}
						second={sample => sample.networkSend}
					/>
				</section>
				<section className="min-w-0">
					<Rates title="Disk I/O" receive={latest.diskRead} send={latest.diskWrite} />
					<Chart
						history={props.history}
						hours={props.hours}
						title="Disk I/O"
						value={sample => sample.diskRead}
						second={sample => sample.diskWrite}
					/>
					<div className="mt-3 flex items-center justify-between gap-2 text-xs">
						<h3 className="font-medium">Storage</h3>
						<span className="text-muted-foreground font-mono tabular-nums">{size(storage.total)} total</span>
					</div>
					<Capacity
						label="Storage capacity"
						tracks={[{capacity: storage.total, parts: [{label: 'Used', opacity: 1, value: storage.used}]}]}
					/>
				</section>
			</div>
			<p className="text-muted-foreground mt-3 text-right text-xs empty:hidden">
				{Boolean.match(props.history.stale, {
					onFalse: () =>
						Boolean.match(started > chartWindow(props.hours, props.history.time).start + resolution(props.hours), {
							onFalse: () => '',
							onTrue: () => `since ${stamp.format(started)}`
						}),
					onTrue: () => `last seen ${stamp.format(latest.time)}`
				})}
			</p>
		</section>
	)
}

function History(props: {machine: string; hours: HistoryQuery['hours']}) {
	const result = useAtomSuspense(metricsAtom(props.hours), {includeFailure: true})
	if (AsyncResult.isFailure(result)) return <ResultError result={result} />
	const machines = Array.filter(
		result.value,
		machine =>
			(props.machine === 'all' || props.machine === machine.worker) && Array.isReadonlyArrayNonEmpty(machine.samples)
	)
	return (
		<div className="pb-safe flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-3">
			{Array.map(machines, machine => (
				<Machine key={machine.worker} history={machine} hours={props.hours} />
			))}
			{Array.isArrayEmpty(machines) && (
				<p className="text-muted-foreground text-xs">No recorded history for this selection.</p>
			)}
		</div>
	)
}

export function ResourceHistory(props: {machine: string}) {
	const [hours, setHours] = useState<HistoryQuery['hours']>(1)
	const [pending, transition] = useTransition()
	return (
		<section className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={pending}>
			<div className="flex shrink-0 items-center justify-end gap-2">
				<ToggleGroup
					aria-label="History range"
					disabled={pending}
					value={[`${hours}`]}
					onValueChange={values =>
						transition(() => {
							if (values[0] === '24') setHours(24)
							else if (values[0] === '168') setHours(168)
							else if (values[0] === '1') setHours(1)
						})
					}
				>
					<ToggleGroupItem value="1">1h</ToggleGroupItem>
					<ToggleGroupItem value="24">24h</ToggleGroupItem>
					<ToggleGroupItem value="168">7d</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<Suspense fallback={<Skeleton className="h-64 w-full" />}>
				<History machine={props.machine} hours={hours} />
			</Suspense>
		</section>
	)
}
