import {Array, Boolean, Function, Number, Option, String, pipe} from 'effect'

import {percentOf} from '@deslop/runtime/shared/format'

import {ItemId} from '#inventory/contract.ts'
import type {Snapshot} from '#inventory/contract.ts'
import {shown} from '#inventory/screen.ts'
import type {MachineHistory} from '#metrics/contract.ts'
import {machineReadings, statistics} from '#metrics/screen.ts'

export const MACHINE = ItemId.make('machine')

export function machineHost(snapshot: Snapshot) {
	return pipe(
		snapshot.items,
		Array.findFirst(item => Option.contains(item.self, true)),
		Option.flatMap(item => item.hostname)
	)
}

const decimal = new Intl.NumberFormat('en', {maximumFractionDigits: 1})
function gib(bytes: number) {
	return decimal.format(bytes / 1024 ** 3)
}

function machineName(snapshot: Snapshot) {
	return Option.match(machineHost(snapshot), {
		onNone: Function.constant('Machine'),
		onSome: hostname => Array.headNonEmpty(String.split(hostname, '.'))
	})
}

export function machineDetail(snapshot: Snapshot, history?: MachineHistory) {
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const readings = machineReadings(history)
	const disks = history?.disks ?? []
	const used = Number.sumAll(Array.map(disks, disk => disk.used))
	const total = Number.sumAll(Array.map(disks, disk => disk.total))

	return {
		cpu: shown(latest?.cpu ?? Option.none(), percentOf),
		disk: Boolean.match(total > 0, {onFalse: Function.constant('—'), onTrue: () => `${gib(used)} / ${gib(total)} GiB`}),
		memory: Option.match(Option.fromUndefinedOr(latest), {
			onNone: Function.constant('—'),
			onSome: sample => `${gib(sample.memoryUsed)} / ${gib(sample.memoryTotal)} GiB`
		}),
		name: machineName(snapshot),
		peak: statistics(readings),
		readings
	}
}

export function loadAverages(history?: MachineHistory) {
	if (Array.isReadonlyArrayEmpty(history?.load ?? [])) return undefined
	return pipe(
		history?.load ?? [],
		Array.map(value => value.toFixed(2)),
		Array.join(' / ')
	)
}
