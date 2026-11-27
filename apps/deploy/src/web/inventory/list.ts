import {Array, Boolean, Function, Number, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import {clockOf, percentOf} from '@deslop/runtime/shared/format'
import {Notice, Placeholder, Row as AxisRow} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {SymbolIcon} from '@deslop/ui/symbol'

import {workloadName} from '#contracts'
import type {InventoryItem, ItemId, MachineHistory, Row, Snapshot} from '#contracts'

import {runJob} from '#web/inventory/actions.ts'
import {LoadingMachine} from '#web/inventory/loading.ts'
import {MACHINE, Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {appFigures, machineReadings} from '#web/inventory/readings.ts'
import {addressOf, machineHost, shown, statusLine} from '#web/inventory/rows.ts'
import {Trace} from '#web/inventory/traces.ts'
import {Capacity, Memory, Percent, UsageBar} from '#web/inventory/usage.ts'

export function Mark(h: H, health: InventoryItem['health'], restart = false) {
	if (health === 'quiet' && !restart) return undefined
	return h.span
		.class('axis-dot deploy-dot')
		.attrs({
			'aria-hidden': 'true',
			'data-status': Boolean.match(health === 'warning' && !restart, {
				onFalse: Function.constant('error'),
				onTrue: Function.constant('warning')
			})
		})
}

export function Job(h: H, row: Row, admin: boolean, pending: boolean, current: boolean, status?: string) {
	const name = workloadName(row.item)
	const line =
		status ??
		Boolean.match(row.item.running, {
			onFalse: Function.constant('Job · next run'),
			onTrue: Function.constant('Job · running')
		})
	return h.div
		.key(row.item.id)
		.class('deploy-job')
		.children(
			AxisRow(h, {
				className: Boolean.match(row.item.health === 'warning', {
					onFalse: Function.constant(''),
					onTrue: Function.constant('deploy-warning')
				}),
				current,
				id: row.item.id,
				line,
				open: Message.Select({id: row.item.id}),
				problem: row.item.health !== 'quiet',
				title: name,
				value: shown(row.item.next, at => clockOf(at))
			}).attr('aria-label', `Open ${name}`),
			admin &&
				Button(h, {disabled: row.item.running || pending})
					.class('axis-control deploy-icon-control')
					.attr('aria-label', `Run ${name} now`)
					.on('click', runJob(row.item))
					.children(SymbolIcon(h, 'play.fill'))
		)
}

export function MachineName(snapshot: Snapshot) {
	return Option.match(machineHost(snapshot), {
		onNone: Function.constant('Machine'),
		onSome: hostname => Array.headNonEmpty(String.split(hostname, '.'))
	})
}

function MachineFigures(history?: MachineHistory) {
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const disks = history?.disks ?? []
	return {
		cpu: latest?.cpu ?? Option.none<number>(),
		disk: pipe(
			disks,
			Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
			Option.map(values => Number.sumAll(Array.map(values, disk => disk.used)))
		),
		diskTotal: Option.liftPredicate(Number.sumAll(Array.map(disks, disk => disk.total)), value => value > 0),
		memory: Option.fromUndefinedOr(latest?.memoryUsed),
		memoryTotal: Option.fromUndefinedOr(latest?.memoryTotal)
	}
}

export function MachineCard(h: H, now: DateTime.Utc, snapshot: Snapshot, loading: boolean, history?: MachineHistory) {
	const name = MachineName(snapshot)
	const figures = MachineFigures(history)
	return [
		h.span.class('col-span-full text-base font-semibold').children(name),
		...Boolean.match(loading, {
			onFalse: () => [
				h.span
					.class('deploy-numeral deploy-hero')
					.children(Percent(h, figures.cpu), ' ', h.span.class('deploy-caption').children('CPU')),
				h.span.class('deploy-sparkline').children(Trace(h, machineReadings(history), now)),
				Capacity(h, 'Memory', figures.memory, figures.memoryTotal),
				Capacity(h, 'Disk', figures.disk, figures.diskTotal)
			],
			onTrue: () => LoadingMachine(h)
		})
	]
}

export type Focused = {id: ItemId; line?: string; restart?: string}

export type ListProps = {
	admin: boolean
	focused?: Focused
	history?: MachineHistory
	loading: boolean
	now: DateTime.Utc
	pending: boolean
	rows: readonly Row[]
	selected: Option.Option<ItemId>
	snapshot: Snapshot
	stale: boolean
}

function rowLine(row: Row, cpu: Option.Option<number>, status?: string) {
	if (status !== undefined) return status
	const line = addressOf(row) ?? Option.getOrUndefined(Option.map(cpu, value => `${percentOf(value)} CPU`))
	if (row.item.kind !== 'container') return line
	if (line === undefined) return 'Container'
	return `${line} · Container`
}

export function List(h: H, props: ListProps) {
	const latest = Option.getOrUndefined(Array.last(props.history?.samples ?? []))
	const rows = Array.map(props.rows, row => ({figures: appFigures(row.item, latest), row}))
	const maxMemory = Array.reduce(rows, 0, (max, entry) => {
		if (Option.contains(entry.row.item.scheduled, true)) return max
		return Number.max(max, Option.getOrElse(entry.figures.memory, Function.constant(0)))
	})
	return h.div.class('deploy-list-body').children(
		Button(h)
			.class('deploy-card deploy-machine')
			.attrs({
				'aria-current': `${Option.contains(props.selected, MACHINE)}`,
				'aria-label': `Open ${MachineName(props.snapshot)}`
			})
			.on('click', Message.Select({id: MACHINE}))
			.children(MachineCard(h, props.now, props.snapshot, props.loading, props.history)),
		Array.isReadonlyArrayEmpty(rows) && Notice(h, 'No apps'),
		Array.map(rows, entry => {
			const row: Row = entry.row
			const focused = Option.getOrUndefined(
				Option.filter(Option.fromUndefinedOr(props.focused), focus => focus.id === row.item.id)
			)
			const current = Option.contains(props.selected, row.item.id)
			const line = focused?.line ?? statusLine(row, props.now)
			if (Option.contains(row.item.scheduled, true)) {
				return Job(h, row, props.admin, props.pending, current, line ?? addressOf(row))
			}
			const name = workloadName(row.item)
			return AxisRow(h, {
				className: Boolean.match(row.item.health === 'warning' && focused?.restart === undefined, {
					onFalse: Function.constant('deploy-list-row'),
					onTrue: Function.constant('deploy-list-row deploy-warning')
				}),
				current,
				id: row.item.id,
				line: rowLine(row, entry.figures.cpu, line),
				open: Message.Select({id: row.item.id}),
				problem: row.item.health !== 'quiet' || focused?.restart !== undefined,
				title: name,
				value: Boolean.match(props.loading && Option.isNone(entry.figures.memory), {
					onFalse: () => [
						UsageBar(h, entry.figures.memory, maxMemory),
						h.span.class('deploy-reading').children(Memory(h, entry.figures.memory))
					],
					onTrue: () => [Placeholder(h, 'deploy-bar-placeholder'), Placeholder(h, 'deploy-value-placeholder')]
				})
			}).attr('aria-label', `Open ${name}`)
		}),
		props.stale && Notice(h, 'Apps may be out of date', Message.Retry())
	)
}
