import {Array, Boolean, Function, Number, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import {bytesOf, clockOf, percentOf} from '@deslop/runtime/shared/format'
import {Notice, Placeholder, Row as AxisRow} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'
import {SymbolIcon} from '@deslop/ui/symbol'

import {workloadName} from '#contracts'
import type {InventoryItem, ItemId, MachineHistory, Row, Snapshot} from '#contracts'

import {runJob} from '#web/inventory/actions.ts'
import type {Reading} from '#web/inventory/chart.ts'
import {MACHINE, Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {appFigures, appReadings, machineReadings} from '#web/inventory/readings.ts'
import {host, machineHost, shown, statusLine} from '#web/inventory/rows.ts'
import {Restarts, Ruler, Trace} from '#web/inventory/traces.ts'

export function Figures(h: H, cpu: Option.Option<number>, memory?: Option.Option<number>) {
	return h.span.class('axis-value deploy-figures').children(
		h.span.children(
			Option.match(cpu, {
				onNone: Function.constant('—'),
				onSome: value => {
					const formatted = percentOf(value)
					return h.span.children(String.slice(0, -1)(formatted), h.small.children('%'))
				}
			})
		),
		memory !== undefined && h.small.class('axis-muted').children(shown(memory, bytesOf))
	)
}

export function Mark(h: H, health: InventoryItem['health'], restart = false) {
	if (health === 'quiet' && !restart) return undefined
	return h.span
		.class('axis-dot deploy-dot')
		.attr(
			'data-status',
			Boolean.match(health === 'warning' && !restart, {
				onFalse: Function.constant('error'),
				onTrue: Function.constant('warning')
			})
		)
}

export function Url(h: H, item: InventoryItem) {
	return Option.match(item.url, {
		onNone: () => Option.getOrUndefined(Option.map(item.port, port => `:${port}`)),
		onSome: url => h.a.attrs({href: url, rel: 'noreferrer', target: '_blank', title: url}).children(host(url))
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
				Glass(h).children(
					Button(h, {disabled: row.item.running || pending})
						.class('deploy-icon-control')
						.attr('aria-label', `Run ${name} now`)
						.on('click', runJob(row.item))
						.children(SymbolIcon(h, 'play.fill'))
				)
		)
}

export function MachineName(snapshot: Snapshot) {
	return Option.match(machineHost(snapshot), {
		onNone: Function.constant('Machine'),
		onSome: hostname => Array.headNonEmpty(String.split(hostname, '.'))
	})
}

export function MachineFigures(history?: MachineHistory) {
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const total = pipe(
		history?.disks ?? [],
		Array.map(disk => disk.total),
		Number.sumAll
	)
	const used = pipe(
		history?.disks ?? [],
		Array.map(disk => disk.used),
		Number.sumAll
	)
	return {
		cpu: latest?.cpu ?? Option.none<number>(),
		disk: pipe(
			total,
			Option.liftPredicate(value => value > 0),
			Option.map(capacity => (100 * used) / capacity)
		),
		memory: Option.fromUndefinedOr(latest?.memoryUsed),
		memoryTotal: Option.fromUndefinedOr(latest?.memoryTotal)
	}
}

export type Focused = {id: ItemId; line?: string; restart?: string; restarts: readonly DateTime.Utc[]}

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

function rowFallback(row: Row) {
	return pipe(
		row.listeners,
		Array.findFirst(listener => Option.isSome(listener.port)),
		Option.flatMap(listener => listener.port),
		Option.match({
			onNone: () => {
				const count = Option.getOrElse(row.item.processes, Array.empty).length
				if (count === 1) return '1 process'
				if (count > 1) return `${count} processes`
				return undefined
			},
			onSome: port => `:${port}`
		})
	)
}

function rowValue(
	h: H,
	props: ListProps,
	readings: readonly Reading[],
	figures: ReturnType<typeof appFigures>,
	restarts: readonly DateTime.Utc[] = []
) {
	if (props.loading) {
		return [Placeholder(h, 'deploy-trace-placeholder'), Placeholder(h, 'deploy-value-placeholder')]
	}
	return [
		h.span.class('deploy-list-trace').children(Trace(h, readings, props.now), Restarts(h, restarts, props.now)),
		Figures(h, figures.cpu, figures.memory)
	]
}

export function List(h: H, props: ListProps) {
	const latest = Option.getOrUndefined(Array.last(props.history?.samples ?? []))
	const machine = MachineFigures(props.history)
	const machineName = MachineName(props.snapshot)
	return h.div.class('deploy-list-body').children(
		h.div.class('deploy-list-ruler').children(!props.loading && Ruler(h)),
		Array.isReadonlyArrayEmpty(props.rows) && Notice(h, 'No apps'),
		Array.map(props.rows, row => {
			const item = row.item
			const focused = Option.filter(Option.fromUndefinedOr(props.focused), focus => focus.id === item.id)
			const currentFocus = Option.getOrUndefined(focused)
			const current = Option.contains(props.selected, item.id)
			const line = Option.match(focused, {onNone: () => statusLine(row, props.now), onSome: focus => focus.line})
			if (Option.contains(item.scheduled, true)) return Job(h, row, props.admin, props.pending, current, line)
			const readings = Boolean.match(item.kind === 'service' || item.kind === 'container', {
				onFalse: Array.empty,
				onTrue: () => appReadings(item, props.history)
			})
			const figures = appFigures(item, latest)
			return AxisRow(h, {
				className: Boolean.match(item.health === 'warning' && currentFocus?.restart === undefined, {
					onFalse: Function.constant('deploy-list-row'),
					onTrue: Function.constant('deploy-list-row deploy-warning')
				}),
				current,
				id: item.id,
				line: line ?? rowFallback(row),
				open: Message.Select({id: item.id}),
				problem: item.health !== 'quiet' || currentFocus?.restart !== undefined,
				title: workloadName(item),
				value: rowValue(h, props, readings, figures, currentFocus?.restarts)
			}).attr('aria-label', `Open ${workloadName(item)}`)
		}),
		props.stale && Notice(h, 'Apps may be out of date', Message.Retry()),
		AxisRow(h, {
			className: 'deploy-list-row deploy-machine-row',
			current: Option.contains(props.selected, MACHINE),
			id: MACHINE,
			line: pipe(
				[Option.map(machine.memoryTotal, bytesOf), Option.map(machine.disk, disk => `disk ${percentOf(disk)}`)],
				Array.getSomes,
				Array.join(' · ')
			),
			open: Message.Select({id: MACHINE}),
			title: machineName,
			value: rowValue(h, props, machineReadings(props.history), machine)
		}).attr('aria-label', `Open ${machineName}`)
	)
}
