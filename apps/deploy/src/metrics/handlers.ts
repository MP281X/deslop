import {
	Array,
	Boolean,
	Cache,
	DateTime,
	Duration,
	Effect,
	Number,
	Option,
	Order,
	Record,
	Schedule,
	Schema,
	Scope,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {HistoryQuery, MetricsRpcs, ResourceHistory} from './contract.ts'
import type {AppUsage, BandId, MachineHistory, Sample} from './contract.ts'
import {SERIES, chartWindow, resolution} from './history.ts'
import {Metrics} from './server.ts'

import type {AppId} from '#inventory/contract.ts'
import {Inventory} from '#inventory/server.ts'
import {ownerNames} from '#inventory/workloads.ts'
import {DeployError} from '#machine/contract.ts'
import {Machine} from '#machine/server.ts'

type MetricSummary = typeof MetricSummary.Type
const MetricSummary = Schema.Struct({
	last: Schema.OptionFromOptionalKey(Schema.Finite),
	max: Schema.OptionFromOptionalKey(Schema.Finite),
	min: Schema.OptionFromOptionalKey(Schema.Finite),
	samples: Schema.Int
})

// Each of the range's 60 slots in order, with None for a missing sample or reading and Some for its rounded value.
function series(machine: MachineHistory, minutes: Duration.Duration, read: (sample: Sample) => Option.Option<number>) {
	const start = chartWindow(minutes, machine.time).start
	const slot = resolution(minutes)
	const bySlot = Record.fromIterableWith(
		machine.samples,
		point =>
			[
				`${Number.clamp(Math.ceil(Duration.toMillis(DateTime.distance(start, point.time)) / Duration.toMillis(slot)) - 1, {maximum: 59, minimum: 0})}`,
				point
			] as const
	)
	return Array.makeBy(60, index =>
		pipe(
			Option.fromUndefinedOr(bySlot[`${index}`]),
			Option.flatMap(read),
			Option.map(value => Number.round(value, 1))
		)
	)
}

const ResourceSummary = ResourceHistory.mapFields(fields => ({
	...fields,
	cpuPct: MetricSummary,
	diskPct: MetricSummary,
	memoryPct: MetricSummary,
	series: Schema.OptionFromOptionalKey(Schema.Struct(Struct.pick(fields, ['cpuPct', 'diskPct', 'memoryPct'])))
}))

function metricSummary(points: readonly Option.Option<number>[]) {
	const values = Array.getSomes(points)
	return {
		last: Option.flatten(Array.last(points)),
		max: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.max(measured, Order.Number))
		}),
		min: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.min(measured, Order.Number))
		}),
		samples: values.length
	}
}

export const metricsTools = Toolkit.make(
	Tool.make('read_resource_history', {
		description:
			'Inspect current capacity, memory-ranked consumers and min/max/last resource percentages with sample coverage. Set series=true to add the aligned 60-point history with null gaps when timing or spikes matter.',
		failure: DeployError,
		parameters: Schema.Struct({
			...HistoryQuery.fields,
			series: pipe(Schema.Boolean, Schema.withDecodingDefaultTypeKey(Effect.succeed(false)))
		}),
		success: ResourceSummary
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true)
)

function diskTotal(machine: MachineHistory) {
	return Array.match(machine.disks, {
		onEmpty: () => Option.none<number>(),
		onNonEmpty: disks => Option.some(Number.sumAll(Array.map(disks, disk => disk.total)))
	})
}

// A band's label: the page's name for the app when it has a row, else the unit or container the id names.
function bandName(id: BandId, labels: Record<AppId, string>) {
	if (id === 'other') return 'Low impact'
	if (id === 'system') return 'System'
	return pipe(
		labels,
		Record.get(id),
		Option.getOrElse(() =>
			String.replaceAll(
				/^service:[a-z]+:(?:deslop-)?|\.service$/gu,
				''
			)(String.replace(/^container:/u, 'container ')(id))
		)
	)
}

function appsOf(labels: Record<AppId, string>, latest: Sample) {
	const sorted = Array.sort(
		pipe(
			latest.apps,
			Option.getOrElse(Array.empty),
			Array.map(
				app =>
					({
						cpu: Option.map(app.cpu, value => Number.round(value, 1)),
						mib: Number.round(app.memory / 1024 ** 2, 0),
						name: bandName(app.id, labels)
					}) satisfies AppUsage
			)
		),
		pipe(
			Order.flip(Order.Number),
			Order.mapInput((app: AppUsage) => app.mib),
			Order.combine(Order.mapInput(Order.String, (app: AppUsage) => app.name))
		)
	)
	if (sorted.length <= 15) return sorted
	const rest = Array.drop(sorted, 15)
	const cpus = Array.getSomes(Array.map(rest, (app: AppUsage) => app.cpu))
	return [
		...Array.take(sorted, 15),
		{
			cpu: Array.match(cpus, {
				onEmpty: () => Option.none(),
				onNonEmpty: values => Option.some(Number.round(Number.sumAll(values), 1))
			}),
			mib: Number.sumAll(Array.map(rest, (app: AppUsage) => app.mib)),
			name: 'other'
		} satisfies AppUsage
	]
}

// Memory, CPU and disk as 60 aligned points with the current figures and the heaviest apps, in as few tokens as the page's charts need.
function resourceHistory(machine: MachineHistory, minutes: HistoryQuery['minutes'], labels: Record<AppId, string>) {
	const latest = Array.last(machine.samples)
	const storageTotal = diskTotal(machine)
	return {
		apps: Option.match(latest, {onNone: () => [], onSome: point => appsOf(labels, point)}),
		cpuPct: series(machine, minutes, point => point.cpu),
		diskPct: series(machine, minutes, point =>
			Option.flatMap(point.storageUsed, used => Option.map(storageTotal, total => (used / total) * 100))
		),
		error: machine.error,
		from: chartWindow(minutes, machine.time).start,
		memoryPct: series(machine, minutes, point => Option.some((point.memoryUsed / point.memoryTotal) * 100)),
		now: Option.map(latest, point => ({
			cpuPct: Option.map(point.cpu, value => Number.round(value, 1)),
			diskGiB: Option.map(point.storageUsed, used => Number.round(used / 1024 ** 3, 1)),
			diskTotalGiB: Option.map(storageTotal, total => Number.round(total / 1024 ** 3, 1)),
			load: Option.liftPredicate(machine.load, Array.isReadonlyArrayNonEmpty),
			memoryGiB: Number.round(point.memoryUsed / 1024 ** 3, 1),
			memoryTotalGiB: Number.round(point.memoryTotal / 1024 ** 3, 1)
		})),
		stale: Option.liftPredicate(true as const, () => machine.stale),
		stepSeconds: resolution(minutes)
	}
}

export const metricsToolHandlers = metricsTools.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		const metrics = yield* Metrics
		return metricsTools.of({
			read_resource_history: Effect.fnUntraced(function* (input) {
				const value = yield* Effect.all(
					{history: metrics.read({minutes: input.minutes}), snapshot: machine.snapshot},
					{concurrency: 'unbounded'}
				)
				const history = resourceHistory(value.history, input.minutes, ownerNames(value.snapshot))
				return {
					...history,
					cpuPct: metricSummary(history.cpuPct),
					diskPct: metricSummary(history.diskPct),
					memoryPct: metricSummary(history.memoryPct),
					series: pipe(
						history,
						Struct.pick(['cpuPct', 'diskPct', 'memoryPct']),
						Option.liftPredicate(() => input.series)
					)
				}
			})
		})
	})
)

export const metricsHandlers = MetricsRpcs.toLayer(
	Effect.gen(function* () {
		const inventory = yield* Inventory
		const metrics = yield* Metrics
		// A cache lookup inherits its caller's scope; shared sources belong to this layer, not the first RPC.
		const scope = yield* Effect.scope
		// Viewers share one range sampler; the source stops when its last viewer leaves.
		const histories = yield* Cache.make({
			capacity: Record.size(SERIES),
			lookup: Effect.fnUntraced(function* (minutes: HistoryQuery['minutes']) {
				return yield* pipe(
					Stream.fromEffectSchedule(
						metrics.read({minutes}),
						pipe(
							minutes,
							Duration.equals(Duration.hours(1)),
							Boolean.match({
								onFalse: () => Duration.min(resolution(minutes), Duration.seconds(30)),
								onTrue: () => Duration.seconds(5)
							}),
							Schedule.spaced
						)
					),
					Stream.share({capacity: 1, replay: 1, strategy: 'sliding'}),
					Effect.provideService(Scope.Scope, scope)
				)
			})
		})
		return MetricsRpcs.of({
			'metrics.app': input =>
				Stream.fromEffectSchedule(
					Effect.gen(function* () {
						const time = yield* DateTime.now
						const hour = yield* Effect.all(
							{processes: metrics.processHistory(input, time), restarts: inventory.restarts(input, time)},
							{concurrency: 'unbounded'}
						)
						return {...hour, time}
					}),
					Schedule.spaced(Duration.seconds(5))
				),
			'metrics.watch': query => Stream.unwrap(Cache.get(histories, query.minutes))
		})
	})
)
