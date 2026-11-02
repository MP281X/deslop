import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Number, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState, useTransition} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {metricsAtom} from '#lib/utils.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const numbers = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})
const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'})
const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})

function size(value?: number) {
	if (value === undefined) return '—'
	if (value >= 1024 ** 3) return `${numbers.format(value / 1024 ** 3)} GiB`
	if (value >= 1024 ** 2) return `${numbers.format(value / 1024 ** 2)} MiB`
	return `${numbers.format(value / 1024)} KiB`
}

function rate(value?: number) {
	if (value === undefined) return '—'
	return `${size(value)}/s`
}

function Sparkline(props: {
	history: MachineHistory
	hours: number
	title: string
	value: (sample: Sample) => Sample['cpu']
	second?: (sample: Sample) => Sample['cpu']
	maximum?: number
}) {
	const window = chartWindow(props.history.samples, props.hours, props.history.time)
	const maximum = Array.reduce(props.history.samples, props.maximum ?? 1, (max, sample) =>
		Number.max(max, Number.max(props.value(sample) ?? 0, props.second?.(sample) ?? 0))
	)
	function path(second: boolean) {
		return Array.join(
			Array.map(props.history.samples, (sample, index) => {
				const value = Boolean.match(second, {onFalse: () => props.value(sample), onTrue: () => props.second?.(sample)})
				if (value === undefined) return ''
				const previous = props.history.samples[index - 1]
				const defined =
					previous !== undefined &&
					Boolean.match(second, {onFalse: () => props.value(previous), onTrue: () => props.second?.(previous)}) !==
						undefined
				const command = Boolean.match(
					defined && sample.time - (previous?.time ?? 0) <= Number.max(90_000, (window.end - window.start) / 239),
					{onFalse: () => 'M', onTrue: () => 'L'}
				)
				return `${command}${((sample.time - window.start) / (window.end - window.start)) * 300},${42 - (value / maximum) * 38}`
			}),
			' '
		)
	}
	return (
		<svg
			role="img"
			aria-label={`${props.history.worker} ${props.title} history`}
			viewBox="0 0 300 46"
			preserveAspectRatio="none"
			className="mt-2 h-14 w-full"
		>
			<path d="M0 42H300" stroke="var(--border)" fill="none" />
			<path d={path(false)} stroke="var(--primary)" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
			{props.second !== undefined && (
				<path
					d={path(true)}
					stroke="var(--muted-foreground)"
					strokeDasharray="3 3"
					fill="none"
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
				/>
			)}
		</svg>
	)
}

function Machine(props: {history: MachineHistory; hours: HistoryQuery['hours']}) {
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	if (latest === undefined) return null
	const root = Option.getOrUndefined(Array.findFirst(latest.disks, disk => disk.mount === '/'))
	return (
		<section
			aria-label={`${props.history.worker} resource history`}
			className={`border-b pb-4 ${Boolean.match(props.history.stale, {onFalse: () => '', onTrue: () => 'opacity-50'})}`}
		>
			<header className="mb-3 flex items-center justify-between gap-2 text-xs">
				<h2 className="flex items-center gap-2 font-semibold">
					<MachineIcon worker={props.history.worker} />
					{machineName(props.history.worker)}
				</h2>
				<span className="text-muted-foreground font-mono">
					{Boolean.match(props.history.stale, {onFalse: () => '', onTrue: () => 'Last recorded · '})}
					{Boolean.match(props.hours === 1, {
						onFalse: () =>
							date.formatRange(chartWindow(props.history.samples, props.hours, props.history.time).start, latest.time),
						onTrue: () =>
							time.formatRange(chartWindow(props.history.samples, props.hours, props.history.time).start, latest.time)
					})}
				</span>
			</header>
			<div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
				<div>
					<h3 className="text-muted-foreground text-xs">CPU</h3>
					<div className="font-mono text-sm tabular-nums">
						{Option.match(Option.fromUndefinedOr(latest.cpu), {
							onNone: () => '—',
							onSome: value => `${numbers.format(value)}%`
						})}
					</div>
					<Sparkline
						history={props.history}
						hours={props.hours}
						title="CPU"
						value={sample => sample.cpu}
						maximum={100}
					/>
				</div>
				<div>
					<h3 className="text-muted-foreground text-xs">Memory</h3>
					<div className="font-mono text-sm tabular-nums">
						{size(latest.memoryUsed)} <span className="text-muted-foreground">/ {size(latest.memoryTotal)}</span>
					</div>
					<Sparkline
						history={props.history}
						hours={props.hours}
						title="Memory"
						value={sample => sample.memoryUsed}
						maximum={latest.memoryTotal}
					/>
				</div>
				<div>
					<h3 className="text-muted-foreground text-xs">Storage</h3>
					<div className="font-mono text-sm tabular-nums">
						{size(root?.used)} <span className="text-muted-foreground">/ {size(root?.total)}</span>
					</div>
					<Sparkline
						history={props.history}
						hours={props.hours}
						title="Storage"
						maximum={root?.total}
						value={sample =>
							Option.getOrUndefined(
								Option.map(
									Array.findFirst(sample.disks, disk => disk.mount === '/'),
									disk => disk.used
								)
							)
						}
					/>
				</div>
				<div>
					<h3 className="text-muted-foreground text-xs">Network</h3>
					<div className="font-mono text-sm tabular-nums">
						↓ {rate(latest.networkReceive)} <span className="text-muted-foreground">↑ {rate(latest.networkSend)}</span>
					</div>
					<Sparkline
						history={props.history}
						hours={props.hours}
						title="Network"
						value={sample => sample.networkReceive}
						second={sample => sample.networkSend}
					/>
				</div>
			</div>
			<details className="mt-3 text-xs">
				<summary className="text-muted-foreground cursor-pointer py-1">
					Details · {latest.cores?.length ?? 0} cores
				</summary>
				<div className="grid grid-cols-2 gap-x-6 gap-y-2 py-3 sm:grid-cols-4">
					{Array.map(latest.cores ?? [], core => (
						<div key={core.id} className="flex justify-between gap-2 font-mono">
							<span className="text-muted-foreground">{core.id}</span>
							<span>
								{Option.match(Option.fromUndefinedOr(core.usage), {
									onNone: () => '—',
									onSome: usage => `${numbers.format(usage)}%`
								})}
							</span>
						</div>
					))}
				</div>
				<dl className="[&_dt]:text-muted-foreground grid grid-cols-2 gap-2 [&_dd]:text-right [&_dd]:font-mono">
					<dt>Swap</dt>
					<dd>
						{size(latest.swapUsed)} / {size(latest.swapTotal)}
					</dd>
					<dt>Available memory</dt>
					<dd>{size(latest.memoryAvailable)}</dd>
					<dt>Cached memory</dt>
					<dd>{size(latest.memoryCached)}</dd>
					<dt>Disk read / write</dt>
					<dd>
						{rate(latest.diskRead)} · {rate(latest.diskWrite)}
					</dd>
					{Array.map(
						Array.filter(latest.disks, disk => disk.mount !== '/'),
						disk => (
							<div key={disk.mount} className="col-span-2 flex justify-between gap-2">
								<dt>{disk.mount}</dt>
								<dd>
									{size(disk.used)} / {size(disk.total)}
								</dd>
							</div>
						)
					)}
				</dl>
				<p className="text-muted-foreground mt-2">{props.history.cpuModel}</p>
			</details>
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
		<div className="pb-safe flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			{Array.map(machines, machine => (
				<Machine key={machine.worker} history={machine} hours={props.hours} />
			))}
			{Array.isArrayEmpty(machines) && (
				<p className="text-muted-foreground text-xs">No cached history for this selection.</p>
			)}
		</div>
	)
}

export function ResourceHistory(props: {machine: string}) {
	const [hours, setHours] = useState<HistoryQuery['hours']>(1)
	const [pending, transition] = useTransition()
	return (
		<section className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={pending}>
			<div className="flex shrink-0 items-center justify-between gap-2">
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
