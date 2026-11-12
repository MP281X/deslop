import {Schema} from 'effect'

import {Model} from 'effect/schema'

export type HistoryQuery = typeof HistoryQuery.Type
// The range back from now, in minutes: a minute, ten, an hour, a day or a week.
export const HistoryQuery = Schema.Struct({minutes: Schema.Literals([1, 10, 60, 1440, 10_080])})

export type HistoryToolInput = typeof HistoryToolInput.Type
export const HistoryToolInput = Schema.Struct({
	...HistoryQuery.fields,
	worker: Schema.optionalKey(Schema.String.annotate({description: 'A configured worker name.'}))
})

export type Series = typeof Series.Type
export const Series = Schema.Array(Schema.OptionFromNullOr(Schema.Finite))

export type AppUsage = typeof AppUsage.Type
export const AppUsage = Schema.Struct({cpu: Schema.optionalKey(Schema.Finite), mib: Schema.Int, name: Schema.String})

export type MachineNow = typeof MachineNow.Type
export const MachineNow = Schema.Struct({
	cpuPct: Schema.optionalKey(Schema.Finite),
	diskGiB: Schema.optionalKey(Schema.Finite),
	diskTotalGiB: Schema.optionalKey(Schema.Finite),
	load: Schema.optionalKey(Schema.Array(Schema.Finite)),
	memoryGiB: Schema.Finite,
	memoryTotalGiB: Schema.Finite
})

export type WorkerHistory = typeof WorkerHistory.Type
export const WorkerHistory = Schema.Struct({
	apps: Schema.Array(AppUsage),
	cpuPct: Series,
	diskPct: Series,
	error: Schema.optionalKey(Schema.String),
	from: Schema.String,
	memoryPct: Series,
	now: Schema.optionalKey(MachineNow),
	stale: Schema.optionalKey(Schema.Literal(true)),
	stepSeconds: Schema.Finite,
	worker: Schema.String
})

export type ResourceHistory = typeof ResourceHistory.Type
export const ResourceHistory = Schema.Array(WorkerHistory)

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cpuIdle: Schema.Finite,
	cpuTotal: Schema.Finite,
	time: Schema.Finite,
	uptime: Schema.Finite
})

export type AppSample = typeof AppSample.Type
export const AppSample = Schema.Struct({
	cpu: Schema.optionalKey(Schema.Finite),
	id: Schema.String,
	memory: Schema.Finite
})

// One point of a worker's history in the series of one spacing: its readings from `since` to `time`, each averaged over the time it covers.
export class Sample extends Model.Class<Sample>('Sample')({
	// Each service or container's memory and its CPU as a share of the whole machine, from its cgroup, keyed like `itemOwner`; none where no cgroup was read, as on a Mac.
	apps: Model.FieldOption(Model.JsonFromString(Schema.Array(AppSample))),
	cpu: Model.FieldOption(Schema.Finite),
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	since: Schema.Int,
	// The series' spacing in milliseconds: each range reads the one whose 60 slots hold a few points each.
	step: Schema.Int,
	// The machine's used space in bytes, summed over its mounted disks.
	storageUsed: Model.FieldOption(Schema.Finite),
	time: Schema.Int
}) {
	static readonly table = 'samples'
}

export type Disk = typeof Disk.Type
export const Disk = Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	cpuModel: Schema.optionalKey(Schema.String),
	// The newest reading's disks and load averages, which no chart draws over time.
	disks: Schema.Array(Disk),
	error: Schema.String,
	load: Schema.Array(Schema.Finite),
	samples: Schema.Array(Sample.json),
	stale: Schema.Boolean,
	time: Schema.Finite,
	worker: Schema.String
})
