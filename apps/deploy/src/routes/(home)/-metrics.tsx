import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Number, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState, useTransition} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {metricsAtom} from '#lib/utils.ts'
import type {HistoryQuery, MachineHistory, Sample} from '#services/metrics/schema.ts'

const bytes = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})
const compact = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1, notation: 'compact'})
const relative = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto', style: 'short'})

function sampleAge(time: number, now: number) {
	const seconds = Number.max(0, Math.floor((now - time) / 1000))
	if (seconds < 60) return relative.format(-seconds, 'second')
	if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
	if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3600), 'hour')
	if (seconds < 604_800) return relative.format(-Math.floor(seconds / 86_400), 'day')
	return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(time)
}

function size(value: number) {
	if (value >= 1024 ** 3) return `${bytes.format(value / 1024 ** 3)} GiB`
	if (value >= 1024 ** 2) return `${bytes.format(value / 1024 ** 2)} MiB`
	return `${bytes.format(value / 1024)} KiB`
}

function Chart(props: {
	history: MachineHistory
	hours: number
	title: string
	value: (sample: Sample) => Sample['cpu']
	second?: (sample: Sample) => Sample['cpu']
	maximum?: number
	percent?: boolean
}) {
	const now = props.history.time
	const start = now - props.hours * 3_600_000
	const values = Array.map(props.history.samples, sample => ({
		second: props.second?.(sample),
		time: sample.time,
		value: props.value(sample)
	}))
	const maximum = Number.max(
		1,
		props.maximum ??
			Array.reduce(values, 1, (max, point) => Number.max(max, Number.max(point.value ?? 0, point.second ?? 0)))
	)
	const value = Option.getOrUndefined(Option.map(Array.last(props.history.samples), props.value))
	const secondary = Option.getOrUndefined(
		Option.map(Array.last(props.history.samples), sample => props.second?.(sample))
	)
	function path(second: boolean) {
		return Array.join(
			Array.map(values, (point, index) => {
				const y = Boolean.match(second, {onFalse: () => point.value, onTrue: () => point.second})
				if (y === undefined) return ''
				const previous = values[index - 1]
				const command = Boolean.match(
					Boolean.match(second, {onFalse: () => previous?.value, onTrue: () => previous?.second}) === undefined ||
						point.time - (previous?.time ?? 0) > Number.max(90_000, ((props.hours * 3_600_000) / 480) * 2),
					{onFalse: () => 'L', onTrue: () => 'M'}
				)
				return `${command}${Number.clamp(((point.time - start) / (now - start)) * 300, {maximum: 300, minimum: 0})},${64 - Number.min(1, y / maximum) * 60}`
			}),
			' '
		)
	}
	function format(number?: number) {
		if (number === undefined) return '—'
		if (props.percent === true) return `${bytes.format(number)}%`
		if (props.second !== undefined) return compact.format(number)
		return size(number)
	}
	return (
		<div className="min-w-0 py-2">
			<div className="flex min-h-10 flex-col items-start gap-1 text-xs sm:min-h-4 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
				<h3 className="font-medium">{props.title}</h3>
				<span className="font-mono tabular-nums">
					{format(value)}
					{props.second !== undefined && ` ↓ / ${format(secondary)} ↑`}
					{props.second !== undefined && ' B/s'}
				</span>
			</div>
			<svg
				role="img"
				aria-label={`${props.history.worker} ${props.title} over ${props.hours} ${Boolean.match(props.hours === 1, {onFalse: () => 'hours', onTrue: () => 'hour'})}`}
				viewBox="0 0 300 68"
				className="text-primary mt-1 h-20 w-full"
				preserveAspectRatio="none"
			>
				<path d="M0 64H300" stroke="var(--border)" fill="none" />
				<path d={path(false)} stroke="currentColor" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
				{value !== undefined && (
					<circle
						cx={Number.clamp(
							((Option.getOrElse(
								Option.map(Array.last(values), point => point.time),
								() => start
							) -
								start) /
								(now - start)) *
								300,
							{maximum: 300, minimum: 0}
						)}
						cy={64 - Number.min(1, value / maximum) * 60}
						r={1.5}
						fill="currentColor"
					/>
				)}
				{props.second !== undefined && (
					<path
						d={path(true)}
						stroke="currentColor"
						strokeDasharray="3 3"
						fill="none"
						strokeWidth="1.5"
						vectorEffect="non-scaling-stroke"
					/>
				)}
			</svg>
			<div className="text-muted-foreground flex justify-between font-mono text-xs">
				<span>−{props.hours}h</span>
				<span>now</span>
			</div>
		</div>
	)
}

function History(props: {machine: string; hours: HistoryQuery['hours']}) {
	const result = useAtomSuspense(metricsAtom(props.hours), {includeFailure: true})
	if (AsyncResult.isFailure(result)) return <ResultError result={result} />
	return (
		<div className="flex flex-col gap-4">
			{Array.map(
				Array.filter(result.value, machine => props.machine === '' || props.machine === machine.worker),
				machine => {
					const latest = Option.getOrUndefined(Array.last(machine.samples))
					const storage = Option.getOrUndefined(Array.findFirst(latest?.disks ?? [], disk => disk.mount === '/'))
					return (
						<section key={machine.worker} aria-label={`${machine.worker} resource history`} className="border-b pb-4">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<h2 className="font-mono text-sm font-semibold">{machine.worker}</h2>
								<span className="text-muted-foreground text-xs">
									{Boolean.match(machine.stale, {onFalse: () => 'Sampled', onTrue: () => 'Unavailable · last sample'})}{' '}
									{Option.match(Array.last(machine.samples), {
										onNone: () => 'waiting for first sample',
										onSome: sample => sampleAge(sample.time, machine.time)
									})}
								</span>
							</div>
							{machine.error !== '' && (
								<p className="text-warning text-xs wrap-anywhere" role="status">
									{machine.error}
								</p>
							)}
							{latest === undefined && (
								<p className="text-muted-foreground py-2 text-xs">
									No samples in this range. Deploy records while the agent is running.
								</p>
							)}
							{latest !== undefined && (
								<>
									<div
										className={`grid grid-cols-2 gap-x-6 ${Boolean.match(machine.stale, {onFalse: () => '', onTrue: () => 'opacity-50'})}`}
									>
										<Chart
											history={machine}
											hours={props.hours}
											title="CPU"
											value={sample => sample.cpu}
											maximum={100}
											percent
										/>
										<Chart
											history={machine}
											hours={props.hours}
											title="Memory"
											value={sample => sample.memoryUsed}
											maximum={latest.memoryTotal}
										/>
										<Chart
											history={machine}
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
											maximum={storage?.total}
										/>
										<Chart
											history={machine}
											hours={props.hours}
											title="Network"
											value={sample => sample.networkReceive}
											second={sample => sample.networkSend}
										/>
										<Chart
											history={machine}
											hours={props.hours}
											title="Disk I/O"
											value={sample => sample.diskRead}
											second={sample => sample.diskWrite}
										/>
										<Chart
											history={machine}
											hours={props.hours}
											title="Swap"
											value={sample => sample.swapUsed}
											maximum={latest.swapTotal}
										/>
									</div>
									<div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
										<span>
											RAM{' '}
											<span className="font-mono">
												{size(latest.memoryUsed)} / {size(latest.memoryTotal)}
											</span>
										</span>
										{Array.map(latest.disks, disk => (
											<span key={disk.mount}>
												<span className="font-mono">{disk.mount}</span>{' '}
												<span className="font-mono">
													{size(disk.used)} / {size(disk.total)}
												</span>
											</span>
										))}
									</div>
								</>
							)}
						</section>
					)
				}
			)}
			<p className="text-muted-foreground text-xs">30s samples · 7d retained · dashed line: send/write</p>
		</div>
	)
}

export function ResourceHistory(props: {machine: string}) {
	const [hours, setHours] = useState<HistoryQuery['hours']>(1)
	const [pending, transition] = useTransition()
	return (
		<section className="flex flex-col gap-3" aria-busy={pending}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">System</h2>
				<ToggleGroup
					aria-label="History range"
					disabled={pending}
					value={[`${hours}`]}
					onValueChange={values => {
						transition(() => {
							if (values[0] === '24') setHours(24)
							else if (values[0] === '168') setHours(168)
							else setHours(1)
						})
					}}
				>
					<ToggleGroupItem value="1">1h</ToggleGroupItem>
					<ToggleGroupItem value="24">24h</ToggleGroupItem>
					<ToggleGroupItem value="168">7d</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<Suspense
				fallback={
					<div className="grid grid-cols-2 gap-4">
						<Skeleton className="h-28" />
						<Skeleton className="h-28" />
					</div>
				}
			>
				<History machine={props.machine} hours={hours} />
			</Suspense>
		</section>
	)
}
