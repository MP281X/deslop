import {Array, Boolean, Function, Number, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import {bytesOf, clockOf, percentOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'

import {requestOf, workloadName} from '#contracts'
import type {Row, InventoryItem, ItemId, Snapshot, AppHour, MachineHistory} from '#contracts'

import {Operation} from '#web/inventory/client.ts'
import {MACHINE, Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {appFigures, appReadings, machineReadings} from '#web/inventory/readings.ts'
import {host, machineHost, shown, reasonLine} from '#web/inventory/rows.ts'
import {Restarts, RestartReason, Ruler, Trace} from '#web/inventory/traces.ts'

export function Glyph(h: H, path: string) {
	return h
		.el('svg')
		.attrs({
			'aria-hidden': 'true',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'stroke-width': '2',
			viewBox: '0 0 24 24'
		})
		.children(h.el('path').attr('d', path))
}

export function Figures(h: H, cpu: Option.Option<number>, memory?: Option.Option<number>) {
	return h.div.class('axis-value deploy-figures').children(
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
		.class('deploy-dot')
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

function Name(h: H, item: InventoryItem, loud: boolean, restart: boolean, muted?: string) {
	return h.div
		.class('deploy-name')
		.children(
			h.span
				.class('axis-title', (loud || restart) && 'deploy-strong')
				.children(Mark(h, item.health, restart), workloadName(item)),
			h.span.class('axis-muted').children(muted)
		)
}

function jobLine(item: InventoryItem, now: DateTime.Utc) {
	if (item.health !== 'quiet') return reasonLine(item, now)
	if (item.running) return 'job · running'
	return 'job · next run'
}

export function Job(h: H, row: Row, admin: boolean, pending: boolean, now: DateTime.Utc) {
	const name = workloadName(row.item)
	return h.div
		.key(row.item.id)
		.class('axis-row deploy-job')
		.children(
			h.div.class('deploy-name').children(
				Button(h, {})
					.attr('aria-label', `Open ${name}`)
					.on('click', () => Message.Select({id: row.item.id}))
					.children(
						h.span.class('axis-title').children(Mark(h, row.item.health), name),
						h.span.class('axis-muted').children(jobLine(row.item, now))
					)
			),
			h.div.class('deploy-job-tail').children(
				h.span.class('axis-value').children(shown(row.item.next, at => clockOf(at))),
				admin &&
					Button(h, {disabled: row.item.running || pending})
						.attr('aria-label', `Run ${name} now`)
						.on('click', () => Message.Operation({operation: Operation.cases.Run.make({request: requestOf(row.item)})}))
						.children(Glyph(h, 'm8 5 12 7-12 7Z'))
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

export type ListProps = {
	admin: boolean
	history?: MachineHistory
	now: DateTime.Utc
	pending: boolean
	processes?: AppHour
	rows: readonly Row[]
	selected: Option.Option<ItemId>
	snapshot: Snapshot
}

function rowLine(row: Row, now: DateTime.Utc, restart?: string) {
	if (row.item.health !== 'quiet') return reasonLine(row.item, now)
	if (restart !== undefined) return restart
	const address = Array.flatMap(row.exposures, site => Option.toArray(site.url))[0]
	if (address !== undefined) return host(address)
	const port = Array.flatMap(row.listeners, listener => Option.toArray(listener.port))[0]
	if (port !== undefined) return `:${port}`
	const count = Option.getOrElse(row.item.processes, Array.empty).length
	if (count === 1) return '1 process'
	if (count > 1) return `${count} processes`
	return undefined
}

export function List(h: H, props: ListProps) {
	const latest = Option.getOrUndefined(Array.last(props.history?.samples ?? []))
	const machine = MachineFigures(props.history)
	const machineSelected = Option.contains(props.selected, MACHINE)
	return h.div.class('deploy-list-body').children(
		h.div.class('deploy-list-ruler').children(Ruler(h)),
		Array.isReadonlyArrayEmpty(props.rows) && h.p.class('deploy-notice').attr('role', 'status').children('No apps'),
		Array.map(props.rows, row => {
			const item = row.item
			if (Option.contains(item.scheduled, true)) return Job(h, row, props.admin, props.pending, props.now)
			const selected = Option.contains(props.selected, item.id)
			const readings = Boolean.match(item.kind === 'service' || item.kind === 'container', {
				onFalse: Array.empty,
				onTrue: () => appReadings(item, props.history)
			})
			const restarts = Boolean.match(selected, {onFalse: Array.empty, onTrue: () => props.processes?.restarts ?? []})
			const restart = RestartReason(restarts, props.now)
			const figures = appFigures(item, latest)
			return h.div
				.key(item.id)
				.class('axis-row deploy-list-row')
				.attr(
					'data-selected',
					Boolean.match(selected, {onFalse: Function.constUndefined, onTrue: Function.constant('')})
				)
				.children(
					Button(h, {})
						.attrs({
							'aria-current': Boolean.match(selected, {
								onFalse: Function.constUndefined,
								onTrue: Function.constant('true')
							}),
							'aria-label': `Open ${workloadName(item)}`
						})
						.on('click', () => Message.Select({id: item.id}))
						.children(
							Name(
								h,
								item,
								Option.exists(figures.cpu, cpu => cpu >= 5) || selected,
								restart !== undefined,
								rowLine(row, props.now, restart)
							),
							h.div
								.class('deploy-list-trace')
								.children(Trace(h, readings, props.now), Restarts(h, restarts, props.now)),
							Figures(h, figures.cpu, figures.memory)
						)
				)
		}),
		h.div
			.class('axis-row deploy-list-row deploy-machine-row')
			.attr(
				'data-selected',
				Boolean.match(machineSelected, {onFalse: Function.constUndefined, onTrue: Function.constant('')})
			)
			.children(
				Button(h, {})
					.attrs({
						'aria-current': Boolean.match(machineSelected, {
							onFalse: Function.constUndefined,
							onTrue: Function.constant('true')
						}),
						'aria-label': `Open ${MachineName(props.snapshot)}`
					})
					.on('click', () => Message.Select({id: MACHINE}))
					.children(
						h.div
							.class('deploy-name')
							.children(
								h.span.class('axis-title deploy-strong').children(MachineName(props.snapshot)),
								h.span
									.class('axis-muted')
									.children(
										pipe(
											[
												Option.map(machine.memoryTotal, bytesOf),
												Option.map(machine.disk, disk => `disk ${percentOf(disk)}`)
											],
											Array.getSomes,
											Array.join(' · ')
										)
									)
							),
						h.div.class('deploy-list-trace').children(Trace(h, machineReadings(props.history), props.now)),
						Figures(h, machine.cpu, machine.memory)
					)
			)
	)
}
