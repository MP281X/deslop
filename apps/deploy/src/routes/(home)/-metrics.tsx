import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Number, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState, useTransition} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {MachineIcon, machineColor, machineName} from '#lib/components.tsx'
import {metricsAtom} from '#lib/utils.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const numbers = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})
const axisNumbers = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0, notation: 'compact'})
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'short'})
const relative = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto', style: 'short'})

function sampleAge(timestamp: number, now: number) {
	const seconds = Number.max(0, Math.floor((now - timestamp) / 1000))
	if (seconds < 60) return relative.format(-seconds, 'second')
	if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
	if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3600), 'hour')
	if (seconds < 604_800) return relative.format(-Math.floor(seconds / 86_400), 'day')
	return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(timestamp)
}

function size(value?: number) {
	if (value === undefined) return '—'
	if (value >= 1024 ** 3) return `${numbers.format(value / 1024 ** 3)} GiB`
	if (value >= 1024 ** 2) return `${numbers.format(value / 1024 ** 2)} MiB`
	if (value >= 1024) return `${numbers.format(value / 1024)} KiB`
	return `${numbers.format(value)} B`
}

function percent(value?: number) {
	if (value === undefined) return '—'
	return `${numbers.format(value)}%`
}

function Meter(props: {label: string; used: number; total: number; worker: string}) {
	const value = Number.clamp((props.used / Number.max(1, props.total)) * 100, {maximum: 100, minimum: 0})
	return (
		<div
			role="meter"
			aria-label={props.label}
			aria-valuenow={value}
			aria-valuemin={0}
			aria-valuemax={100}
			className="bg-secondary h-1.5 w-full overflow-hidden rounded-sm"
		>
			<div
				className="h-full w-(--fill) bg-(--machine)"
				style={{'--fill': `${value}%`, '--machine': machineColor(props.worker)}}
			/>
		</div>
	)
}

function Chart(props: {
	history: MachineHistory
	hours: number
	title: string
	value: (sample: Sample) => Sample['cpu']
	second?: (sample: Sample) => Sample['cpu']
	percent?: boolean
	capacity?: boolean
}) {
	const window = chartWindow(props.history.samples, props.hours, props.history.time)
	const values = Array.map(props.history.samples, sample => ({
		second: props.second?.(sample),
		time: sample.time,
		value: props.value(sample)
	}))
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	const maximum = Boolean.match(props.percent === true, {
		onFalse: () =>
			Number.max(
				1,
				Array.reduce(values, 0, (max, point) => Number.max(max, Number.max(point.value ?? 0, point.second ?? 0))) * 1.1
			),
		onTrue: () =>
			Number.min(
				100,
				Number.max(25, Math.ceil(Array.reduce(values, 0, (max, point) => Number.max(max, point.value ?? 0)) / 25) * 25)
			)
	})
	function format(value?: number) {
		if (value === undefined) return '—'
		if (props.percent === true) return percent(value)
		if (props.capacity === true) return size(value)
		return `${size(value)}/s`
	}
	function path(second: boolean) {
		return Array.join(
			Array.map(values, (point, index) => {
				const value = Boolean.match(second, {onFalse: () => point.value, onTrue: () => point.second})
				if (value === undefined) return ''
				const previous = values[index - 1]
				const command = Boolean.match(
					Boolean.match(second, {onFalse: () => previous?.value, onTrue: () => previous?.second}) === undefined ||
						point.time - (previous?.time ?? 0) > Number.max(90_000, (window.end - window.start) / 239),
					{onFalse: () => 'L', onTrue: () => 'M'}
				)
				return `${command}${Number.clamp(((point.time - window.start) / (window.end - window.start)) * 300, {maximum: 300, minimum: 0})},${96 - Number.clamp(value / maximum, {maximum: 1, minimum: 0}) * 92}`
			}),
			' '
		)
	}
	return (
		<div className="min-w-0" aria-label={`${props.title} chart`}>
			<div className="flex h-7 items-baseline justify-between gap-2 text-xs">
				<h3 className="font-semibold">{props.title}</h3>
				<span className="font-mono tabular-nums">
					{format(Option.getOrUndefined(Option.map(Option.fromUndefinedOr(latest), props.value)))}
				</span>
			</div>
			<div className="text-muted-foreground flex h-5 justify-between font-mono text-xs">
				{props.second !== undefined && (
					<>
						<span>↓ {Boolean.match(props.title === 'Network', {onFalse: () => 'read', onTrue: () => 'receive'})}</span>
						<span>
							↑ {Boolean.match(props.title === 'Network', {onFalse: () => 'write', onTrue: () => 'send'})}{' '}
							{format(
								Option.getOrUndefined(Option.map(Option.fromUndefinedOr(latest), sample => props.second?.(sample)))
							)}
						</span>
					</>
				)}
			</div>
			<div className="relative pl-18">
				<div className="text-muted-foreground absolute inset-y-0 left-0 flex w-16 flex-col justify-between text-right font-mono text-xs whitespace-nowrap">
					<span>
						{Boolean.match(props.percent === true || props.capacity === true, {
							onFalse: () => `${axisNumbers.format(maximum)}B/s`,
							onTrue: () => format(maximum)
						})}
					</span>
					<span>0</span>
				</div>
				<svg
					role="img"
					aria-label={`${props.history.worker} ${props.title} history`}
					viewBox="0 0 300 100"
					className="h-28 w-full"
					preserveAspectRatio="none"
				>
					<path d="M0 4H300M0 50H300M0 96H300" stroke="var(--border)" fill="none" strokeDasharray="2 4" />
					<path
						d={path(false)}
						stroke={machineColor(props.history.worker)}
						fill="none"
						strokeWidth="1.5"
						vectorEffect="non-scaling-stroke"
					/>
					{props.second !== undefined && (
						<path
							d={path(true)}
							stroke={machineColor(props.history.worker)}
							strokeDasharray="4 3"
							fill="none"
							strokeWidth="1.5"
							vectorEffect="non-scaling-stroke"
						/>
					)}
					{Array.map(
						Array.takeRight(values, 1),
						point =>
							point.value !== undefined && (
								<circle
									key={point.time}
									cx={Number.clamp(((point.time - window.start) / (window.end - window.start)) * 300, {
										maximum: 300,
										minimum: 0
									})}
									cy={96 - Number.clamp(point.value / maximum, {maximum: 1, minimum: 0}) * 92}
									r="2"
									fill={machineColor(props.history.worker)}
								/>
							)
					)}
				</svg>
			</div>
			<div className="text-muted-foreground ml-18 flex justify-between gap-2 font-mono text-xs">
				<span>
					{Boolean.match(window.end - window.start >= 86_400_000, {
						onFalse: () => time.format(window.start),
						onTrue: () => date.format(window.start)
					})}
				</span>
				<span>
					{Boolean.match(window.end - window.start >= 86_400_000, {
						onFalse: () => time.format(window.end),
						onTrue: () => date.format(window.end)
					})}
				</span>
			</div>
		</div>
	)
}

function Machine(props: {history: MachineHistory; hours: HistoryQuery['hours']}) {
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	return (
		<section
			aria-label={`${props.history.worker} resource history`}
			className="flex min-w-0 flex-col gap-4 border-b pb-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<MachineIcon worker={props.history.worker} />
					{machineName(props.history.worker)}
				</h2>
				<span className="text-muted-foreground font-mono text-xs">
					{Boolean.match(props.history.stale, {onFalse: () => 'Updated', onTrue: () => 'Offline · last sample'})}{' '}
					{Option.match(Option.fromUndefinedOr(latest), {
						onNone: () => '—',
						onSome: sample => sampleAge(sample.time, props.history.time)
					})}
				</span>
			</div>
			{props.history.error !== '' && (
				<p className="text-warning text-xs wrap-anywhere" role="status">
					{props.history.error}
				</p>
			)}
			{latest === undefined && <p className="text-muted-foreground text-xs">No recorded samples in this range.</p>}
			{latest !== undefined && (
				<div
					className={`grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 ${Boolean.match(props.history.stale, {onFalse: () => '', onTrue: () => 'opacity-50'})}`}
				>
					<section aria-label="CPU and cores" className="min-w-0 sm:col-span-2">
						<Chart history={props.history} hours={props.hours} title="CPU" value={sample => sample.cpu} percent />
						<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
							{Array.map(latest.cores ?? [], core => (
								<div key={core.id} className="flex items-center gap-1 font-mono text-xs">
									<span className="text-muted-foreground w-10 shrink-0">{core.id}</span>
									<Meter label={core.id} used={core.usage ?? 0} total={100} worker={props.history.worker} />
									<span className="w-12 shrink-0 text-right tabular-nums">{percent(core.usage)}</span>
								</div>
							))}
						</div>
						<div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
							<span>{props.history.cpuModel}</span>
							<span className="font-mono">
								Load{' '}
								{Array.join(
									Array.map(latest.load ?? [], value => numbers.format(value)),
									' / '
								)}
							</span>
							{latest.uptime !== undefined && (
								<span className="font-mono">
									Up {Math.floor(latest.uptime / 86_400)}d {Math.floor((latest.uptime % 86_400) / 3600)}h
								</span>
							)}
						</div>
					</section>
					<section aria-label="Memory and swap" className="flex min-w-0 flex-col gap-3">
						<Chart
							history={props.history}
							hours={props.hours}
							title="Memory"
							value={sample => sample.memoryUsed}
							capacity
						/>
						<div className="flex items-baseline justify-between gap-2 font-mono text-xs">
							<span>
								{size(latest.memoryUsed)} / {size(latest.memoryTotal)}
							</span>
							<span>{percent((latest.memoryUsed / latest.memoryTotal) * 100)}</span>
						</div>
						<Meter
							label="Memory used"
							used={latest.memoryUsed}
							total={latest.memoryTotal}
							worker={props.history.worker}
						/>
						<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs [&_dd]:text-right">
							<dt className="text-muted-foreground">Available</dt>
							<dd className="font-mono tabular-nums">{size(latest.memoryAvailable)}</dd>
							<dt className="text-muted-foreground">Cached</dt>
							<dd className="font-mono tabular-nums">{size(latest.memoryCached)}</dd>
							<dt className="text-muted-foreground">Buffers</dt>
							<dd className="font-mono tabular-nums">{size(latest.memoryBuffers)}</dd>
						</dl>
						<h3 className="mt-2 text-xs font-semibold">Swap</h3>
						<div className="font-mono text-xs">
							{size(latest.swapUsed)} / {size(latest.swapTotal)}
						</div>
						<Meter label="Swap used" used={latest.swapUsed} total={latest.swapTotal} worker={props.history.worker} />
					</section>
					<Chart
						history={props.history}
						hours={props.hours}
						title="Network"
						value={sample => sample.networkReceive}
						second={sample => sample.networkSend}
					/>
					<Chart
						history={props.history}
						hours={props.hours}
						title="Disk I/O"
						value={sample => sample.diskRead}
						second={sample => sample.diskWrite}
					/>
					<section aria-label="Mounted storage" className="flex min-w-0 flex-col gap-3">
						<Chart
							history={props.history}
							hours={props.hours}
							title="Storage · /"
							value={sample =>
								Option.getOrUndefined(
									Option.map(
										Array.findFirst(sample.disks, disk => disk.mount === '/'),
										disk => disk.used
									)
								)
							}
							capacity
						/>
						{Array.map(latest.disks, disk => (
							<div key={disk.mount} className="flex flex-col gap-2">
								<div className="flex justify-between gap-2 font-mono text-xs">
									<span>{disk.mount}</span>
									<span>{percent((disk.used / disk.total) * 100)}</span>
								</div>
								<Meter label={`${disk.mount} used`} used={disk.used} total={disk.total} worker={props.history.worker} />
								<div className="text-muted-foreground font-mono text-xs">
									{size(disk.used)} / {size(disk.total)}
								</div>
							</div>
						))}
					</section>
				</div>
			)}
		</section>
	)
}

function History(props: {machine: string; hours: HistoryQuery['hours']}) {
	const result = useAtomSuspense(metricsAtom(props.hours), {includeFailure: true})
	if (AsyncResult.isFailure(result)) return <ResultError result={result} />
	const machines = Array.filter(result.value, machine => props.machine === 'all' || props.machine === machine.worker)
	return (
		<div className="flex flex-col gap-6">
			{Array.map(machines, machine => (
				<Machine key={machine.worker} history={machine} hours={props.hours} />
			))}
			{Array.isArrayEmpty(machines) && (
				<p className="text-muted-foreground text-xs">This machine is not reporting monitoring data.</p>
			)}
		</div>
	)
}

export function ResourceHistory(props: {machine: string}) {
	const [hours, setHours] = useState<HistoryQuery['hours']>(1)
	const [pending, transition] = useTransition()
	return (
		<section className="flex flex-col gap-4" aria-busy={pending}>
			<div className="flex items-center justify-between gap-2">
				<h1 className="text-sm font-semibold">Monitor</h1>
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
