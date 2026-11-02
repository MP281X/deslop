import {Array, Boolean, Number, Order, Record} from 'effect'

import {chartWindow, resolution} from '#services/metrics/lib/utils.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

// One stacked band, in % of the whole machine at each sample: an app, the small apps together, or what the machine holds beyond the apps.
export type Band = {cpu: number[]; id: string; kind: 'app' | 'other' | 'system'; memory: number[]; opacity: number}

function peak(values: readonly number[]) {
	return Array.reduce(values, 0, Number.max)
}

function total(group: readonly {cpu: number[]; memory: number[]}[], index: number, key: 'cpu' | 'memory') {
	return Array.reduce(group, 0, (sum, app) => sum + (app[key][index] ?? 0))
}

// The apps `known` names that the history recorded, heaviest first, then the small ones as one band and the rest of the machine's use as another.
export function bands(history: MachineHistory, known: readonly string[]) {
	// One lookup per sample, so each app's series reads its entry directly.
	const indexed = Array.map(history.samples, sample =>
		Record.fromEntries(Array.map(sample.apps ?? [], app => [app.id, app]))
	)
	const ids = Array.filter(
		Array.dedupe(Array.flatMap(history.samples, sample => Array.map(sample.apps ?? [], app => app.id))),
		id => Array.contains(known, id)
	)
	// Resident memory counts pages processes share, so the apps together can exceed what the machine uses; they shrink to fit inside it.
	const fit = Array.map(history.samples, (sample, index) =>
		Number.min(
			1,
			sample.memoryUsed /
				Number.max(
					1,
					Array.reduce(ids, 0, (sum, id) => sum + (indexed[index]?.[id]?.memory ?? 0))
				)
		)
	)
	const apps = Array.map(ids, id => ({
		cpu: Array.map(indexed, entries => entries[id]?.cpu ?? 0),
		id,
		memory: Array.map(
			indexed,
			(entries, index) =>
				(((entries[id]?.memory ?? 0) * (fit[index] ?? 1)) / Number.max(1, history.samples[index]?.memoryTotal ?? 1)) *
				100
		)
	}))
	// Never above 5% of the machine's memory or CPU an app is barely visible at the chart's height, so it joins the one band of small apps.
	const small = Array.filter(apps, app => peak(app.memory) < 5 && peak(app.cpu) < 5)
	const large = Array.sort(
		Array.filter(apps, app => !Array.contains(small, app)),
		Order.mapInput(Order.flip(Order.Number), (app: {memory: number[]}) => peak(app.memory))
	)
	const ranked = Array.map(
		large,
		// The machine's hue, strongest for the heaviest app and fading evenly by size down to a fifth.
		(app, rank) => ({...app, kind: 'app' as const, opacity: 0.85 - (rank * 0.65) / Number.max(1, large.length - 1)})
	)
	const other = Array.match(small, {
		onEmpty: () => [],
		onNonEmpty: group => [
			{
				cpu: Array.map(history.samples, (_, index) => total(group, index, 'cpu')),
				id: 'other',
				kind: 'other' as const,
				memory: Array.map(history.samples, (_, index) => total(group, index, 'memory')),
				opacity: 0.35
			}
		]
	})
	return [
		...ranked,
		...other,
		{
			cpu: Array.map(history.samples, (sample, index) => Number.max(0, (sample.cpu ?? 0) - total(apps, index, 'cpu'))),
			id: 'system',
			kind: 'system',
			memory: Array.map(history.samples, (sample, index) =>
				Number.max(0, (sample.memoryUsed / Number.max(1, sample.memoryTotal)) * 100 - total(apps, index, 'memory'))
			),
			opacity: 0.18
		}
	] satisfies Band[]
}

// Each sample's place on the range's 0–100 time axis, split where the recording has a gap or a sample lacks the reading, so a gap stays blank.
export function runs(history: MachineHistory, hours: number, recorded: (sample: Sample) => boolean) {
	const window = chartWindow(hours, history.time)
	return Array.match(
		Array.filter(
			Array.mapAccum(history.samples, {run: 0, time: -Infinity}, (last, sample, index) => {
				const run =
					last.run +
					Boolean.match(sample.time - last.time > resolution(hours) * 1.5 || !recorded(sample), {
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
			})[1],
			point => point.recorded
		),
		{onEmpty: () => [], onNonEmpty: all => Array.groupWith(all, (point, first) => point.run === first.run)}
	)
}
