import {Array, Boolean, DateTime, Function, Number, Option, pipe} from 'effect'

import {itemOwner} from '#contracts'
import type {InventoryItem, MachineHistory, Sample} from '#contracts'

import type {Reading} from '#screens/chart.ts'

function readingsOf(value: (sample: Sample) => Option.Option<number>, history?: MachineHistory) {
	const samples = history?.samples ?? []
	return Array.map(samples, (sample, index) => {
		const start = DateTime.toEpochMillis(sample.since)
		const before = pipe(
			samples,
			Array.get(index - 1),
			Option.match({onNone: () => start - 1000, onSome: previous => DateTime.toEpochMillis(previous.time)})
		)
		return {
			from: DateTime.makeUnsafe(
				Boolean.match(start - before < 1500, {onFalse: () => start - 1000, onTrue: () => before})
			),
			time: sample.time,
			value: value(sample)
		} satisfies Reading
	})
}

export function appReadings(item: InventoryItem, history?: MachineHistory) {
	const owner = itemOwner(item)
	return readingsOf(
		sample =>
			Option.flatMap(sample.apps, apps =>
				pipe(
					apps,
					Array.findFirst(app => app.id === owner),
					Option.match({onNone: Function.constant(Option.some(0)), onSome: app => app.cpu})
				)
			),
		history
	)
}

export function machineReadings(history?: MachineHistory) {
	return readingsOf(sample => sample.cpu, history)
}

export function appFigures(item: InventoryItem, latest?: Sample) {
	const processes = Option.getOrElse(item.processes, Array.empty)
	const reading = Option.flatMap(latest?.apps ?? Option.none(), apps =>
		Array.findFirst(apps, app => app.id === itemOwner(item))
	)
	const cpu = Array.flatMap(processes, process => Option.toArray(process.cpu))
	return {
		cpu: Boolean.match(Array.isArrayNonEmpty(cpu), {
			onFalse: () => Option.flatMap(reading, app => app.cpu),
			onTrue: () => Option.some(Number.sumAll(cpu))
		}),
		memory: Boolean.match(Array.isReadonlyArrayNonEmpty(processes), {
			onFalse: () => Option.map(reading, app => app.memory),
			onTrue: () =>
				pipe(
					processes,
					Array.map(process => process.memory),
					Number.sumAll,
					Option.some
				)
		})
	}
}
