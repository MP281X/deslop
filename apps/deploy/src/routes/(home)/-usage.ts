import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Filter,
	Function,
	HashSet,
	Number,
	Option,
	Order,
	Record,
	Schema,
	pipe
} from 'effect'

import type {AppId} from '#services/inventory/schema.ts'
import {resolution} from '#services/metrics/lib/utils.ts'
import type {AppSample, BandId, MachineHistory, Sample} from '#services/metrics/schema.ts'

export type BandKind = typeof BandKind.Type
const BandKind = Schema.Literals(['app', 'other', 'system'])
export type BandFillKind = typeof BandFillKind.Type
const BandFillKind = Schema.Literals([...BandKind.literals, 'disk'])
type BandMetric = typeof BandMetric.Type
const BandMetric = Schema.Literals(['cpu', 'memory', 'memoryBytes'])

// One stacked band, in % of the whole machine at each sample: an app, the low-impact apps together, or what the machine holds beyond the apps.
export type Band = {cpu: number[]; id: BandId; kind: BandKind; memory: number[]; memoryBytes: number[]; opacity: number}

// A band's fill: an app in the page primary at its rank's opacity, and the low-impact and system blocks two darker greys; identity stays in the list's marks.
export function bandFill(kind: BandFillKind, opacity: number) {
	if (kind === 'other') return {color: 'var(--input)', opacity: 1}
	if (kind === 'system') return {color: 'var(--muted)', opacity: 1}
	if (kind === 'disk') return {color: 'var(--muted-foreground)', opacity: 0.6}
	return {color: 'var(--primary)', opacity}
}

function peak(values: readonly number[]) {
	return Array.reduce(values, 0, Number.max)
}

type Reading = {cpu: number; id: AppId; index: number; memory: number; memoryBytes: number}

// Each app's readings, one per sample it was in, so an app the range barely saw costs only those; apps' memory is measured apart from the machine's, so they shrink to fit inside it.
function appReadings(history: MachineHistory) {
	return pipe(
		history.samples,
		Array.map(sample => Option.getOrElse(sample.apps, Array.empty<AppSample>)),
		Array.flatMap((apps, index) => {
			const sample = history.samples[index]
			const fit = Number.min(
				1,
				(sample?.memoryUsed ?? 0) / Number.max(1, Number.sumAll(Array.map(apps, app => app.memory)))
			)
			return Array.map(
				apps,
				app =>
					({
						cpu: Option.getOrElse(app.cpu, Function.constant(0)),
						id: app.id,
						index,
						memory: ((app.memory * fit) / Number.max(1, sample?.memoryTotal ?? 1)) * 100,
						memoryBytes: app.memory
					}) satisfies Reading
			)
		}),
		Array.groupBy(reading => reading.id)
	)
}

// Readings summed per sample, as a dense series over the history.
function series(history: MachineHistory, readings: readonly Reading[], key: BandMetric) {
	const bySample = Array.groupBy(readings, reading => `${reading.index}`)
	return Array.map(history.samples, (_, index) =>
		Number.sumAll(Array.map(bySample[`${index}`] ?? [], reading => reading[key]))
	)
}

// Never above 5% of the machine's memory or CPU an app is barely visible at the chart's height, so it joins the one low-impact band.
function lowImpactApp(readings: readonly Reading[]) {
	return (
		peak(Array.map(readings, reading => reading.memory)) < 5 && peak(Array.map(readings, reading => reading.cpu)) < 5
	)
}

function bandsOf(history: MachineHistory, apps: ReturnType<typeof appReadings>) {
	const [lowImpact, remaining] = Array.partition(
		Record.toEntries(apps),
		Filter.fromPredicate(entry => lowImpactApp(entry[1]))
	)
	const large = pipe(
		remaining,
		Array.map(entry => ({
			cpu: series(history, entry[1], 'cpu'),
			id: entry[0],
			memory: series(history, entry[1], 'memory'),
			memoryBytes: series(history, entry[1], 'memoryBytes')
		})),
		Array.sort(Order.mapInput(Order.flip(Order.Number), (app: {memory: number[]}) => peak(app.memory)))
	)
	const ranked = Array.map(
		large,
		// The machine's hue, strongest for the heaviest app and fading evenly by size down to a fifth.
		(app, rank) => ({...app, kind: 'app' as const, opacity: 0.85 - (rank * 0.65) / Number.max(1, large.length - 1)})
	)
	const other = Array.match(lowImpact, {
		onEmpty: () => [],
		onNonEmpty: group => {
			const readings = Array.flatMap(group, entry => entry[1])
			return [
				{
					cpu: series(history, readings, 'cpu'),
					id: 'other' as const,
					kind: 'other' as const,
					memory: series(history, readings, 'memory'),
					memoryBytes: series(history, readings, 'memoryBytes'),
					opacity: 0.35
				}
			]
		}
	})
	const all = Array.flatMap(Record.values(apps), Function.identity)
	const used = {
		cpu: series(history, all, 'cpu'),
		memory: series(history, all, 'memory'),
		memoryBytes: series(history, all, 'memoryBytes')
	}
	return [
		...ranked,
		...other,
		{
			cpu: Array.map(history.samples, (sample, index) =>
				Number.max(0, Option.getOrElse(sample.cpu, Function.constant(0)) - (used.cpu[index] ?? 0))
			),
			id: 'system' as const,
			kind: 'system',
			memory: Array.map(history.samples, (sample, index) =>
				Number.max(0, (sample.memoryUsed / Number.max(1, sample.memoryTotal)) * 100 - (used.memory[index] ?? 0))
			),
			memoryBytes: Array.map(history.samples, (sample, index) =>
				Number.max(0, sample.memoryUsed - (used.memoryBytes[index] ?? 0))
			),
			opacity: 0.18
		}
	] satisfies Band[]
}

// One app's row figures: its CPU over the history for the sparkline, and its latest sample's CPU and memory in bytes, none where that sample lacks the app.
export type AppFigures = {cpu: readonly number[]; cpuNow: Option.Option<number>; memoryNow: Option.Option<number>}

function figuresOf(history: MachineHistory, readings: readonly Reading[]) {
	const latest = Array.findFirst(readings, reading => reading.index === history.samples.length - 1)
	return {
		cpu: series(history, readings, 'cpu'),
		cpuNow: Option.map(latest, reading => reading.cpu),
		memoryNow: Option.map(latest, reading => reading.memoryBytes)
	} satisfies AppFigures
}

// One history's derived usage, computed once and shared by the list and the charts: the stacked bands, the apps they fold into the low-impact band (which the list's divider uses too), every app the range recorded, and each one's row figures.
export type Usage = {
	bands: Band[]
	figures: Record<AppId, AppFigures>
	history: MachineHistory
	lowImpact: HashSet.HashSet<AppId>
	recorded: HashSet.HashSet<AppId>
}

export function usageOf(history: MachineHistory) {
	const apps = appReadings(history)
	return {
		bands: bandsOf(history, apps),
		figures: Record.map(apps, readings => figuresOf(history, readings)),
		history,
		lowImpact: HashSet.fromIterable(
			pipe(
				Record.toEntries(apps),
				Array.filter(entry => lowImpactApp(entry[1])),
				Array.map(entry => entry[0])
			)
		),
		recorded: HashSet.fromIterable(Record.keys(apps))
	}
}

// The band a selected app focuses: its own when the chart draws it, the low-impact block when it shares that, or none when the range never recorded it.
export function focusedBand(usage: Usage, selected: AppId) {
	if (Array.some(usage.bands, band => band.id === selected)) return Option.some<Band['id']>(selected)
	if (HashSet.has(usage.recorded, selected)) return Option.some<Band['id']>('other')
	return Option.none<Band['id']>()
}

// A usage chart's points, each its time, its sample and every band's stacked share by key. Recorded samples come in runs, split where the recording misses a slot, give or take a second of sampling, or a sample lacks the reading; a blank point after each run keeps the gap blank, and a lone reading widens to a slot so it shows.
export function chartPoints(
	history: MachineHistory,
	minutes: Duration.Duration,
	recorded: (sample: Sample) => boolean,
	layers: readonly {values: readonly number[]}[]
) {
	const slot = Duration.toMillis(resolution(minutes))
	function pointOf(at: number, index: number, value: (layer: {values: readonly number[]}) => number | null) {
		return {
			...Record.fromEntries(Array.map(layers, (layer, band) => [`band${band}`, value(layer)] as const)),
			at,
			index
		}
	}
	return pipe(
		Array.mapAccum(history.samples, {run: 0, time: Option.none<DateTime.Utc>()}, (last, sample, index) => {
			const run =
				last.run +
				Boolean.match(
					!Option.exists(last.time, time =>
						pipe(
							time,
							DateTime.distance(sample.time),
							Duration.isLessThanOrEqualTo(
								pipe(resolution(minutes), Duration.times(1.5), Duration.sum(Duration.seconds(1)))
							)
						)
					) || !recorded(sample),
					{onFalse: Function.constant(0), onTrue: Function.constant(1)}
				)
			return [
				{
					run: run + Boolean.match(recorded(sample), {onFalse: Function.constant(1), onTrue: Function.constant(0)}),
					time: Option.some(sample.time)
				},
				{at: DateTime.toEpochMillis(sample.time), index, recorded: recorded(sample), run}
			]
		})[1],
		Array.filter(point => point.recorded),
		Array.match({
			onEmpty: () => [],
			onNonEmpty: all => Array.groupWith(all, (point, first) => point.run === first.run)
		}),
		Array.flatMap(run => {
			const last = Array.lastNonEmpty(run)
			return [
				...Boolean.match(run.length === 1, {
					onFalse: () => [],
					onTrue: () => [pointOf(last.at - slot, last.index, layer => layer.values[last.index] ?? Function.constNull())]
				}),
				...Array.map(run, point =>
					pointOf(point.at, point.index, layer => layer.values[point.index] ?? Function.constNull())
				),
				pointOf(last.at + 1, last.index, Function.constNull)
			]
		})
	)
}
