import {Array, Boolean, DateTime, Function, Number, Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {axisPosition} from '@deslop/components/chart'
import type {Reading} from '@deslop/components/chart'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {countOf, percentOf} from '@deslop/runtime/shared/format'

import {AppHour, MachineHistory} from './contract.ts'
import type {Sample} from './contract.ts'

import {AppId} from '#inventory/contract.ts'
import type {InventoryItem, Snapshot} from '#inventory/contract.ts'
import {itemOwner} from '#inventory/workloads.ts'

const MetricsRead = AsyncResult.Schema({error: Schema.Unknown, success: MachineHistory})
const AppRead = AsyncResult.Schema({error: Schema.Unknown, success: AppHour})
export type MetricsRead = typeof MetricsRead.Type
export type AppRead = typeof AppRead.Type

// This part of the screen's model and the messages that fill it.
export const metricsFields = {appHistory: AppRead, metrics: MetricsRead}
export const metricsMessages = {AppHistory: {id: AppId, result: AppRead}, Metrics: {result: MetricsRead}}

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

export function memoryOf(bytes: number) {
	return `${countOf(bytes / 1024 ** 2)} MiB`
}

// Restarts in the last ten minutes of the chart.
export function restartReason(restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	const recent = Array.filter(restarts, at => axisPosition(at, now) >= 100 - 100 / 6 && axisPosition(at, now) <= 100)
	if (Array.isArrayEmpty(recent)) return undefined
	if (recent.length === 1) return 'Restarted once in 10 min'
	return `Restarted ${recent.length} times in 10 min`
}

export function statistics(readings: readonly Reading[]) {
	const values = Array.getSomes(Array.map(readings, reading => reading.value))
	if (Array.isArrayEmpty(values)) return '—'
	return `${percentOf(Array.reduce(values, 0, Number.max))}, ${percentOf(Number.sumAll(values) / values.length)}`
}

// What the history pane says about itself: a failed or stale read, a source's problem, or an empty hour; nothing when all is well.
export function historyStatus(
	model: {readonly appHistory: AppRead; readonly metrics: MetricsRead},
	snapshot: Snapshot
) {
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	if (Option.isSome(blockingFailure(model.metrics)) || Option.isSome(blockingFailure(model.appHistory))) {
		return {retry: true, text: 'Couldn’t load history'}
	}
	if (AsyncResult.isFailure(model.metrics) || AsyncResult.isFailure(model.appHistory) || history?.stale === true) {
		return {retry: true, text: 'History may be out of date'}
	}
	const problems = [
		...Array.flatMap(snapshot.sources, source =>
			Option.toArray(Option.map(source.error, reason => `${source.name}: ${reason}`))
		),
		...Option.toArray(history?.error ?? Option.none())
	]
	if (Array.isArrayNonEmpty(problems)) return {retry: false, text: Array.join(problems, ' · ')}
	if (history !== undefined && Array.isReadonlyArrayEmpty(history.samples)) {
		return {retry: false, text: 'No history in the last hour'}
	}
	return undefined
}
