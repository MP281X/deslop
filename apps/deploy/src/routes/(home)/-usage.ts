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

function total(
	group: readonly {cpu: number[]; memory: number[]; memoryBytes: number[]}[],
	index: number,
	key: BandMetric
) {
	return Number.sumAll(Array.map(group, app => app[key][index] ?? 0))
}

function appSeries(history: MachineHistory) {
	// One lookup per sample, so each app's series reads its entry directly.
	const indexed = Array.map(history.samples, sample =>
		pipe(
			sample.apps,
			Option.getOrElse(Array.empty<AppSample>),
			Record.fromIterableBy(app => app.id)
		)
	)
	const ids = pipe(indexed, Array.flatMap(Record.keys), Array.dedupe)
	// Apps' memory and the machine's used memory are measured apart, so together they can disagree by a little; the apps shrink to fit inside it.
	const fit = Array.map(history.samples, (sample, index) =>
		Number.min(
			1,
			sample.memoryUsed / Number.max(1, Number.sumAll(Array.map(ids, id => indexed[index]?.[id]?.memory ?? 0)))
		)
	)
	return Array.map(ids, id => ({
		cpu: Array.map(indexed, entries =>
			pipe(
				Record.get(entries, id),
				Option.flatMap(app => app.cpu),
				Option.getOrElse(Function.constant(0))
			)
		),
		id,
		memory: Array.map(
			indexed,
			(entries, index) =>
				(((entries[id]?.memory ?? 0) * (fit[index] ?? 1)) / Number.max(1, history.samples[index]?.memoryTotal ?? 1)) *
				100
		),
		memoryBytes: Array.map(indexed, entries => entries[id]?.memory ?? 0)
	}))
}

// Never above 5% of the machine's memory or CPU an app is barely visible at the chart's height, so it joins the one low-impact band.
function lowImpactApp(app: ReturnType<typeof appSeries>[number]) {
	return peak(app.memory) < 5 && peak(app.cpu) < 5
}

function bandsOf(history: MachineHistory, apps: ReturnType<typeof appSeries>) {
	const [lowImpact, remaining] = Array.partition(apps, Filter.fromPredicate(lowImpactApp))
	const large = Array.sort(
		remaining,
		Order.mapInput(Order.flip(Order.Number), (app: ReturnType<typeof appSeries>[number]) => peak(app.memory))
	)
	const ranked = Array.map(
		large,
		// The machine's hue, strongest for the heaviest app and fading evenly by size down to a fifth.
		(app, rank) => ({...app, kind: 'app' as const, opacity: 0.85 - (rank * 0.65) / Number.max(1, large.length - 1)})
	)
	const other = Array.match(lowImpact, {
		onEmpty: () => [],
		onNonEmpty: group => [
			{
				cpu: Array.map(history.samples, (_, index) => total(group, index, 'cpu')),
				id: 'other' as const,
				kind: 'other' as const,
				memory: Array.map(history.samples, (_, index) => total(group, index, 'memory')),
				memoryBytes: Array.map(history.samples, (_, index) => total(group, index, 'memoryBytes')),
				opacity: 0.35
			}
		]
	})
	return [
		...ranked,
		...other,
		{
			cpu: Array.map(history.samples, (sample, index) =>
				Number.max(0, Option.getOrElse(sample.cpu, Function.constant(0)) - total(apps, index, 'cpu'))
			),
			id: 'system' as const,
			kind: 'system',
			memory: Array.map(history.samples, (sample, index) =>
				Number.max(0, (sample.memoryUsed / Number.max(1, sample.memoryTotal)) * 100 - total(apps, index, 'memory'))
			),
			memoryBytes: Array.map(history.samples, (sample, index) =>
				Number.max(0, sample.memoryUsed - total(apps, index, 'memoryBytes'))
			),
			opacity: 0.18
		}
	] satisfies Band[]
}

// One history's derived usage, computed once and shared by the list and the charts: the stacked bands, the apps they fold into the low-impact band (which the list's divider uses too), and every app the range recorded.
export type Usage = {
	bands: Band[]
	history: MachineHistory
	lowImpact: HashSet.HashSet<AppId>
	recorded: HashSet.HashSet<AppId>
}

export function usageOf(history: MachineHistory): Usage {
	const apps = appSeries(history)
	return {
		bands: bandsOf(history, apps),
		history,
		lowImpact: HashSet.fromIterable(
			pipe(
				apps,
				Array.filter(lowImpactApp),
				Array.map(app => app.id)
			)
		),
		recorded: HashSet.fromIterable(Array.map(apps, app => app.id))
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
					onTrue: () => [pointOf(last.at - slot, last.index, layer => layer.values[last.index] ?? 0)]
				}),
				...Array.map(run, point => pointOf(point.at, point.index, layer => layer.values[point.index] ?? 0)),
				pointOf(last.at + 1, last.index, Function.constNull)
			]
		})
	)
}
