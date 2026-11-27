import type {View} from '@effect/ui'

import {Array, Boolean, DateTime, Function, HashSet, MutableHashSet, Number, Option, Record, String, pipe} from 'effect'

import {clockOf, durationOf, percentOf} from '@deslop/runtime/shared/format'
import {Notice, Placeholder} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'

import {processTrackUsage, processTree, workloadName} from '#contracts'
import type {AppHour, InventoryItem, MachineHistory, Row, Snapshot} from '#contracts'

import {axisPosition, restartPositions} from '#web/inventory/chart.ts'
import type {Reading} from '#web/inventory/chart.ts'
import {Job, MachineCard, MachineName, Mark} from '#web/inventory/list.ts'
import {LoadingReadings} from '#web/inventory/loading.ts'
import {Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {appFigures, appReadings, machineReadings} from '#web/inventory/readings.ts'
import {addressOf, host, reasonOf, shown, statusLine} from '#web/inventory/rows.ts'
import {CpuScale, Restarts, Ruler, Trace} from '#web/inventory/traces.ts'
import {Memory, Percent, UsageBar} from '#web/inventory/usage.ts'

export type Child = View.Input<Message>

function Fact(h: H, label: string, value: Child, issue = false) {
	return h.div
		.key(label)
		.class('deploy-fact')
		.children(h.dt.class('axis-muted').children(label), h.dd.class(issue && 'deploy-issue').children(value))
}

function statistics(readings: readonly Reading[]) {
	const values = Array.flatMap(readings, reading => Option.toArray(reading.value))
	if (Array.isArrayEmpty(values)) return '—'
	return `${percentOf(Array.reduce(values, 0, Number.max))}, ${percentOf(Number.sumAll(values) / values.length)}`
}

function HistoryChart(
	h: H,
	name: string,
	now: DateTime.Utc,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[],
	status: Child
) {
	const latest = Option.getOrUndefined(
		Array.findLast(
			readings,
			reading =>
				Option.isSome(reading.value) && axisPosition(reading.time, now) > 0 && axisPosition(reading.from, now) < 100
		)
	)
	const hasTrace = latest !== undefined || Array.isArrayNonEmpty(restartPositions(restarts, now))
	return h.figure.class('deploy-card deploy-history').children(
		h.figcaption.class('deploy-caption').children(`${name} · Past hour`),
		hasTrace && [
			h.div
				.class('mt-4 flex items-baseline justify-between')
				.children(
					h.span.class('deploy-numeral deploy-chart-value').children(Percent(h, latest?.value ?? Option.none())),
					h.span.class('deploy-scale').children('CPU')
				),
			h.div.class('deploy-axis').children(
				h.div.class('deploy-large-trace').children(
					Trace(h, readings, now),
					CpuScale(h),
					Restarts(h, restarts, now),
					latest !== undefined &&
						Option.getOrUndefined(
							Option.map(latest.value, value =>
								h.span
									.class('deploy-last-point')
									.attr('aria-hidden', 'true')
									.style({
										insetBlockStart: `${100 - Number.clamp(value, {maximum: 100, minimum: 0})}%`,
										insetInlineStart: `${Number.min(100, axisPosition(latest.time, now))}%`
									})
							)
						)
				),
				Ruler(h)
			)
		],
		status ?? (!hasTrace && Notice(h, 'No CPU readings in the last hour'))
	)
}

function Load(h: H, name: string, history?: MachineHistory) {
	const averages = history?.load ?? []
	if (Array.isReadonlyArrayEmpty(averages)) return undefined
	return h.p.class('deploy-caption mt-3').children(
		name,
		' load · ',
		pipe(
			averages,
			Array.map(value => value.toFixed(2)),
			Array.join(' / ')
		),
		' ',
		h.span.class('deploy-scale').children('(1m / 5m / 15m)')
	)
}

function Processes(h: H, item: InventoryItem, now: DateTime.Utc, history?: AppHour) {
	const current = pipe(item.processes, Option.getOrElse(Array.empty), processTree, processTrackUsage)
	const keys = HashSet.fromIterable(Array.map(current, track => track.key))
	const tracks = [
		...Array.map(current, track => ({
			key: track.key,
			label: track.label,
			lastSeen: Option.none<string>(),
			memory: Option.some(track.memory)
		})),
		...pipe(
			history?.processes ?? [],
			Array.filter(track => !HashSet.has(keys, track.key)),
			Array.flatMap(track =>
				pipe(
					track.samples,
					Array.findLast(sample => {
						const at = axisPosition(sample.time, now)
						return at >= 0 && at <= 100
					}),
					Option.map(sample => ({
						key: track.key,
						label: track.label,
						lastSeen: Option.some(clockOf(sample.time)),
						memory: Option.some(sample.memory)
					})),
					Option.toArray
				)
			)
		)
	]
	if (Array.isArrayEmpty(tracks)) return undefined
	const maxMemory = Array.reduce(tracks, 0, (max, track) =>
		Number.max(max, Option.getOrElse(track.memory, Function.constant(0)))
	)
	return h.div
		.class('deploy-processes')
		.attr('aria-label', 'Memory by process')
		.children(
			Array.map(tracks, track => {
				const label = pipe([track.label.name, track.label.detail], Array.filter(String.isNonEmpty), Array.join(' '))
				return h.div
					.key(track.key)
					.class('deploy-process')
					.children(
						h.span.class('truncate').attr('title', label).children(label),
						UsageBar(h, track.memory, maxMemory),
						h.span
							.class('deploy-reading')
							.attr('title', Option.getOrUndefined(Option.map(track.lastSeen, at => `Last measured at ${at}`)))
							.children(Memory(h, track.memory))
					)
			})
		)
}

function Url(h: H, item: InventoryItem) {
	return Option.match(item.url, {
		onNone: () => Option.getOrUndefined(Option.map(item.port, port => `:${port}`)),
		onSome: url => h.a.attrs({href: url, rel: 'noreferrer', target: '_blank', title: url}).children(host(url))
	})
}

function endpointsOf(h: H, row: Row, free: readonly InventoryItem[], admin: boolean, pending: boolean) {
	const exposures = Array.map(row.exposures, site =>
		h.span.key(site.id).children(Mark(h, site.health), Url(h, site), site.health !== 'quiet' && ` · ${reasonOf(site)}`)
	)
	const ports = MutableHashSet.empty<number>()
	const byId = Record.fromIterableWith(free, item => [item.id, item] satisfies readonly [string, InventoryItem])
	const listeners = Array.flatMap<Row['listeners'][number], View.Content<Message>>(row.listeners, listener => {
		const port = Option.getOrUndefined(listener.port)
		if (port === undefined || MutableHashSet.has(ports, port) || Option.contains(listener.address, 'container')) {
			return []
		}
		MutableHashSet.add(ports, port)
		const target = byId[listener.id]
		if (admin && target !== undefined) {
			return [
				Button(h, {disabled: pending})
					.key(listener.id)
					.class('axis-control deploy-port-control')
					.attr('aria-label', `Expose ${workloadName(row.item)} :${port}`)
					.on('click', Message.OpenedExposure({port: target}))
					.children(`:${port}`)
			]
		}
		return [h.span.key(listener.id).children(`:${port}`)]
	})
	return {exposures, listeners}
}

export type DetailProps = {
	admin: boolean
	app?: AppHour
	free: readonly InventoryItem[]
	history?: MachineHistory
	line?: string
	loading: boolean
	now: DateTime.Utc
	pending: boolean
	restart?: string
	row: Row
	rows: readonly Row[]
	snapshot: Snapshot
	status: Child
}

function UsageFacts(
	h: H,
	item: InventoryItem,
	now: DateTime.Utc,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[],
	restart?: string
) {
	const lastRestart = Array.last(restarts)
	const scheduled = Option.contains(item.scheduled, true)
	return h.div.children(
		Array.isReadonlyArrayNonEmpty(restarts) && Fact(h, 'Restarts', restart ?? `${restarts.length} in 1 h`, true),
		item.running &&
			Option.getOrUndefined(Option.map(lastRestart, at => Fact(h, 'Uptime', durationOf(DateTime.distance(at, now))))),
		Array.isReadonlyArrayNonEmpty(readings) && Fact(h, 'Peak, mean', statistics(readings)),
		scheduled &&
			Fact(
				h,
				'Next run',
				shown(item.next, at => clockOf(at))
			)
	)
}

function EndpointFacts(h: H, props: DetailProps) {
	const row: Row = props.row
	const endpoints = endpointsOf(h, row, props.free, props.admin, props.pending)
	return h.div.children(
		row.item.kind === 'service' && Fact(h, 'Unit', row.item.name),
		Array.isArrayNonEmpty(endpoints.exposures) &&
			Fact(h, 'URL', h.span.class('deploy-endpoints').children(endpoints.exposures)),
		(Array.isArrayNonEmpty(endpoints.listeners) || Option.isSome(row.item.port)) &&
			Fact(
				h,
				'Port',
				h.span
					.class('deploy-endpoints')
					.children(
						Boolean.match(Array.isArrayNonEmpty(endpoints.listeners), {
							onFalse: () => shown(row.item.port, String.String),
							onTrue: () => endpoints.listeners
						})
					)
			),
		Array.isReadonlyArrayNonEmpty(row.exposures) &&
			Fact(
				h,
				'Exposure',
				pipe(
					row.exposures,
					Array.map(site =>
						pipe(
							site.publicAccess,
							Option.contains(true),
							Boolean.match({onFalse: Function.constant('tailnet'), onTrue: Function.constant('public')})
						)
					),
					Array.dedupe,
					Array.join(' · ')
				)
			)
	)
}

function Metric(h: H, label: string, value: Child, loading: boolean) {
	return h.div
		.class('min-w-0')
		.children(
			Boolean.match(loading, {
				onFalse: () => h.div.class('deploy-numeral deploy-hero').children(value),
				onTrue: () => Placeholder(h, 'deploy-hero-placeholder')
			}),
			h.div.class('deploy-caption mt-1.5').children(label)
		)
}

export function Detail(h: H, props: DetailProps) {
	const item: InventoryItem = props.row.item
	const scheduled = Option.contains(item.scheduled, true)
	const figures = appFigures(item, Option.getOrUndefined(Array.last(props.history?.samples ?? [])))
	const charted = !scheduled && (item.kind === 'service' || item.kind === 'container')
	const readings = Boolean.match(charted, {onFalse: Array.empty, onTrue: () => appReadings(item, props.history)})
	const restarts = props.app?.restarts ?? []
	const jobs = Array.filter(
		props.rows,
		candidate =>
			item.kind === 'service' &&
			Option.contains(candidate.item.scheduled, true) &&
			candidate.item.name === String.replace(/\.service$/u, '-update.service')(item.name)
	)
	const name = workloadName(item)
	const subtitle = pipe(
		[props.line ?? '', addressOf(props.row) ?? ''],
		Array.filter(String.isNonEmpty),
		Array.join(' · ')
	)
	return h.div
		.key(item.id)
		.class('deploy-detail-scroll')
		.children(
			h.h2.class('deploy-detail-name').children(Mark(h, item.health, props.restart !== undefined), name),
			String.isNonEmpty(subtitle) && h.p.class('deploy-detail-address').children(subtitle),
			!scheduled &&
				h.div
					.class('deploy-metrics')
					.children(
						Metric(h, 'App CPU', Percent(h, figures.cpu), props.loading && Option.isNone(figures.cpu)),
						Metric(h, 'App memory', Memory(h, figures.memory), props.loading && Option.isNone(figures.memory))
					),
			!charted && props.status,
			charted &&
				Boolean.match(props.loading, {
					onFalse: () => [
						Processes(h, item, props.now, props.app),
						HistoryChart(h, name, props.now, readings, restarts, props.status)
					],
					onTrue: () => LoadingReadings(h)
				}),
			!props.loading && Load(h, MachineName(props.snapshot), props.history),
			h.dl
				.class('deploy-facts')
				.children(
					!props.loading && UsageFacts(h, item, props.now, readings, restarts, props.restart),
					EndpointFacts(h, props)
				),
			Array.map(jobs, job =>
				Job(h, job, props.admin, props.pending, false, statusLine(job, props.now) ?? addressOf(job))
			)
		)
}

export function MachineDetail(
	h: H,
	now: DateTime.Utc,
	snapshot: Snapshot,
	status: Child,
	loading: boolean,
	history?: MachineHistory
) {
	const readings = machineReadings(history)
	const name = MachineName(snapshot)
	return h.div
		.class('deploy-detail-scroll')
		.children(
			h.div.class('deploy-card deploy-machine').children(MachineCard(h, now, snapshot, loading, history)),
			Boolean.match(loading, {
				onFalse: () => HistoryChart(h, name, now, readings, [], status),
				onTrue: () => LoadingReadings(h)
			}),
			!loading && Load(h, name, history),
			!loading &&
				Array.isArrayNonEmpty(readings) &&
				h.dl.class('deploy-facts').children(Fact(h, 'Peak, mean', statistics(readings)))
		)
}
