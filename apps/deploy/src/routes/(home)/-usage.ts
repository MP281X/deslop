import {Array, Boolean, HashSet, Number, Option, Order, Record, String, pipe} from 'effect'

import {APP_HUES} from '@deslop/components-web/apps'

import {chartWindow, resolution} from '#services/metrics/lib/utils.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

// One stacked band, in % of the whole machine at each sample: an app, the low-impact apps together, or what the machine holds beyond the apps.
export type Band = {
	cpu: number[]
	id: string
	kind: 'app' | 'other' | 'system'
	memory: number[]
	memoryBytes: number[]
	opacity: number
}

// A band's fill: a Deslop app in its icon's hue, another process in the page primary at its rank's opacity, and the low-impact and system blocks two darker greys.
export function bandFill(kind: Band['kind'] | 'disk', opacity: number, name: string) {
	if (kind === 'other') return {color: 'var(--input)', opacity: 1}
	if (kind === 'system') return {color: 'var(--muted)', opacity: 1}
	if (kind === 'disk') return {color: 'var(--muted-foreground)', opacity: 0.6}
	return pipe(pipe(String.toLowerCase(name), String.split(/[^a-z0-9]+/u), Array.findFirst(word => Record.has(APP_HUES, word))), Option.flatMap(word => Record.get(APP_HUES, word)), pipelineSubject1048 => Option.match(pipelineSubject1048, {onNone: () => ({color: 'var(--primary)', opacity}), onSome: color => ({color, opacity: 0.9})}))
}

function peak(values: readonly number[]) {
	return Array.reduce(values, 0, Number.max)
}

function total(
	group: readonly {cpu: number[]; memory: number[]; memoryBytes: number[]}[],
	index: number,
	key: 'cpu' | 'memory' | 'memoryBytes'
) {
	return Number.sumAll(Array.map(group, app => app[key][index] ?? 0))
}

function appSeries(history: MachineHistory) {
	// One lookup per sample, so each app's series reads its entry directly.
	const indexed = Array.map(history.samples, sample =>
		Record.fromEntries(pipe(sample.apps, pipelineSubject1862 => Option.getOrElse(pipelineSubject1862, Array.empty), Array.map(app => [app.id, app])))
	)
	const ids = Array.dedupe(Array.flatMap(indexed, Record.keys))
	// Apps' memory and the machine's used memory are measured apart, so together they can disagree by a little; the apps shrink to fit inside it.
	const fit = Array.map(history.samples, (sample, index) =>
		Number.min(
			1,
			sample.memoryUsed / Number.max(1, Number.sumAll(Array.map(ids, id => indexed[index]?.[id]?.memory ?? 0)))
		)
	)
	return Array.map(ids, id => ({
		cpu: Array.map(indexed, entries => entries[id]?.cpu ?? 0),
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
function lowImpactApp(app: {cpu: readonly number[]; memory: readonly number[]}) {
	return peak(app.memory) < 5 && peak(app.cpu) < 5
}

// The apps the chart folds into its low-impact band, which the list's divider uses too.
export function lowImpactIds(history: MachineHistory) {
	return HashSet.fromIterable(pipe(appSeries(history), pipelineSubject3149 => Array.filter(pipelineSubject3149, lowImpactApp), Array.map(app => app.id)))
}

export function bands(history: MachineHistory) {
	const apps = appSeries(history)
	const lowImpact = Array.filter(apps, lowImpactApp)
	const large = pipe(apps, Array.difference(lowImpact), pipelineSubject3365 => Array.sort(pipelineSubject3365, Order.mapInput(Order.flip(Order.Number), (app: {memory: number[]}) => peak(app.memory))))
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
				id: 'other',
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
				Number.max(0, Option.getOrElse(sample.cpu, () => 0) - total(apps, index, 'cpu'))
			),
			id: 'system',
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

// The band a selected app focuses: its own when the chart draws it, the low-impact block when it shares that, or none when the range never recorded it.
export function focusedBand(history: MachineHistory, selected: string) {
	const drawn = Array.some(bands(history), band => band.id === selected)
	const recorded = Array.some(history.samples, sample =>
		Option.exists(sample.apps, apps => Array.some(apps, app => app.id === selected))
	)
	if (drawn) return Option.some(selected)
	if (recorded) return Option.some('other')
	return Option.none()
}

// Each sample's place on the range's 0–100 time axis, split where the recording misses a slot, give or take a second of sampling, or a sample lacks the reading, so a gap stays blank.
export function runs(history: MachineHistory, minutes: number, recorded: (sample: Sample) => boolean) {
	const window = chartWindow(minutes, history.time)
	return pipe(Array.mapAccum(history.samples, {run: 0, time: -Infinity}, (last, sample, index) => {
				const run =
					last.run +
					Boolean.match(sample.time - last.time > resolution(minutes) * 1.5 + 1000 || !recorded(sample), {
						onFalse: () => 0,
						onTrue: () => 1
					})
				return [
					{run: run + Boolean.match(recorded(sample), {onFalse: () => 1, onTrue: () => 0}), time: sample.time},
					{
						index,
						recorded: recorded(sample),
						run,
						x: ((sample.time - window.start) / (window.end - window.start)) * 100
					}
				]
			})[1], Array.filter(point => point.recorded), pipelineSubject5661 => Array.match(pipelineSubject5661, {onEmpty: () => [], onNonEmpty: all => Array.groupWith(all, (point, first) => point.run === first.run)}))
}
