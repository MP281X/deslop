import type {View} from '@effect/ui'

import {Array, Boolean, DateTime, Function, HashSet, MutableHashSet, Number, Option, Record, String, pipe} from 'effect'

import {bytesOf, clockOf, durationOf, percentOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'

import {processTrackUsage, processTree, workloadName} from '#contracts'
import type {Row, InventoryItem, Snapshot, AppHour, MachineHistory} from '#contracts'

import type {Reading} from '#web/inventory/chart.ts'
import {Figures, Job, MachineFigures, MachineName, Mark, Url} from '#web/inventory/list.ts'
import {Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {appFigures, appReadings, machineReadings} from '#web/inventory/readings.ts'
import {host, shown, reasonLine, reasonOf} from '#web/inventory/rows.ts'
import {CpuScale, processReadings, Restarts, RestartReason, Ruler, Trace} from '#web/inventory/traces.ts'

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

function Axes(
	h: H,
	now: DateTime.Utc,
	readings: readonly Reading[],
	children: Child,
	restarts: readonly DateTime.Utc[],
	status: Child
) {
	return h.div
		.class('deploy-axis')
		.children(
			Ruler(h, true),
			h.div
				.class('deploy-axis-body')
				.children(
					h.div.class('deploy-large-trace').children(Trace(h, readings, now, true), CpuScale(h), status),
					children,
					Restarts(h, restarts, now, true)
				)
		)
}

function Processes(h: H, item: InventoryItem, now: DateTime.Utc, history?: AppHour) {
	const current = pipe(item.processes, Option.getOrElse(Array.empty), processTree, processTrackUsage)
	const past = Record.fromIterableWith(
		history?.processes ?? [],
		track => [track.key, track] satisfies readonly [string, typeof track]
	)
	const keys = pipe(
		current,
		Array.map(track => track.key),
		HashSet.fromIterable
	)
	return Array.map(
		[
			...Array.map(current, track => ({
				...track,
				memory: Option.some(track.memory),
				samples: past[track.key]?.samples ?? []
			})),
			...pipe(
				history?.processes ?? [],
				Array.filter(track => !HashSet.has(keys, track.key)),
				Array.map(track => ({...track, cpu: Option.none<number>(), memory: Option.none<number>()}))
			)
		],
		track => {
			const node = track.label.name === 'node' && String.isNonEmpty(track.label.detail)
			return h.div
				.key(track.key)
				.class('axis-row deploy-process')
				.children(
					h.div
						.class('deploy-name')
						.children(
							h.span
								.class('axis-title', Option.exists(track.cpu, cpu => cpu >= 5) && 'deploy-strong')
								.children(
									Boolean.match(node, {
										onFalse: () => track.label.name,
										onTrue: () => `${track.label.name} ${track.label.detail}`
									})
								),
							h.span
								.class('axis-muted')
								.children(
									pipe(
										[
											Boolean.match(node, {onFalse: () => track.label.detail, onTrue: Function.constant('')}),
											Option.match(track.memory, {onNone: Function.constant(''), onSome: bytesOf})
										],
										Array.filter(String.isNonEmpty),
										Array.join(' · ')
									)
								)
						),
					Figures(h, track.cpu),
					Trace(h, processReadings(track.samples), now)
				)
		}
	)
}

function endpointsOf(h: H, row: Row, free: readonly InventoryItem[], admin: boolean) {
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
				Button(h, {})
					.key(listener.id)
					.attr('aria-label', `Expose ${workloadName(row.item)} :${port}`)
					.on('click', () => Message.OpenedExposure({port: target}))
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
	now: DateTime.Utc
	pending: boolean
	row: Row
	rows: readonly Row[]
	status: Child
}

function detailLine(row: Row, now: DateTime.Utc, restart?: string) {
	if (row.item.health !== 'quiet') return reasonLine(row.item, now)
	if (restart !== undefined) return restart
	return pipe(
		row.exposures,
		Array.flatMap(site => Option.toArray(site.url)),
		Array.head,
		Option.map(host),
		Option.getOrUndefined
	)
}

function UsageFacts(
	h: H,
	item: InventoryItem,
	now: DateTime.Utc,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[],
	memory: Option.Option<number>,
	restart?: string
) {
	const lastRestart = Array.last(restarts)
	const scheduled = Option.contains(item.scheduled, true)
	return h.div.children(
		Array.isReadonlyArrayNonEmpty(restarts) && Fact(h, 'Restarts', restart ?? `${restarts.length} in 1 h`, true),
		item.running &&
			Option.getOrUndefined(Option.map(lastRestart, at => Fact(h, 'Uptime', durationOf(DateTime.distance(at, now))))),
		Array.isReadonlyArrayNonEmpty(readings) && Fact(h, 'Peak, mean', statistics(readings)),
		Option.getOrUndefined(Option.map(memory, value => Fact(h, 'Memory', bytesOf(value)))),
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
	const endpoints = endpointsOf(h, row, props.free, props.admin)
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

export function Detail(h: H, props: DetailProps) {
	const item: InventoryItem = props.row.item
	const scheduled = Option.contains(item.scheduled, true)
	const figures = appFigures(item, Option.getOrUndefined(Array.last(props.history?.samples ?? [])))
	const charted = !scheduled && (item.kind === 'service' || item.kind === 'container')
	const readings = Boolean.match(charted, {onFalse: Array.empty, onTrue: () => appReadings(item, props.history)})
	const restarts = props.app?.restarts ?? []
	const restart = RestartReason(restarts, props.now)
	const jobs = Array.filter(
		props.rows,
		candidate =>
			item.kind === 'service' &&
			Option.contains(candidate.item.scheduled, true) &&
			candidate.item.name === String.replace(/\.service$/u, '-update.service')(item.name)
	)
	return h.div
		.key(item.id)
		.class('deploy-detail-scroll')
		.children(
			h.div
				.class('axis-row deploy-detail-lead')
				.children(
					h.div
						.class('deploy-name')
						.children(
							h.span
								.class('axis-title deploy-strong')
								.children(Mark(h, item.health, restart !== undefined), workloadName(item)),
							h.span.class('axis-muted').children(detailLine(props.row, props.now, restart))
						),
					!scheduled && Figures(h, figures.cpu, figures.memory)
				),
			charted && Axes(h, props.now, readings, Processes(h, item, props.now, props.app), restarts, props.status),
			h.dl
				.class('deploy-facts')
				.children(UsageFacts(h, item, props.now, readings, restarts, figures.memory, restart), EndpointFacts(h, props)),
			Array.map(jobs, job => Job(h, job, props.admin, props.pending, props.now))
		)
}

export function MachineDetail(h: H, now: DateTime.Utc, snapshot: Snapshot, status: Child, history?: MachineHistory) {
	const figures = MachineFigures(history)
	const readings = machineReadings(history)
	return h.div.class('deploy-detail-scroll').children(
		h.div
			.class('axis-row deploy-detail-lead')
			.children(
				h.span.class('axis-title deploy-strong').children(MachineName(snapshot)),
				Figures(h, figures.cpu, figures.memory)
			),
		Axes(h, now, readings, undefined, [], status),
		h.dl.class('deploy-facts').children(
			h.div.children(
				Fact(h, 'Peak, mean', statistics(readings)),
				Fact(h, 'Memory', shown(figures.memoryTotal, bytesOf))
			),
			h.div.children(
				Fact(h, 'Disk used', shown(figures.disk, percentOf)),
				Fact(
					h,
					'Load',
					pipe(
						history?.load ?? [],
						Array.map(value => value.toFixed(2)),
						Array.join(' · ')
					)
				)
			)
		)
	)
}
