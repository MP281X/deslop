import {Duration, Schema, SchemaGetter, SchemaParser, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {AppId, TextFromEmpty, WorkerId} from '#services/inventory/schema.ts'

type CpuCounters = typeof CpuCounters.Type
export const CpuCounters = Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5))

type LoadAverages = typeof LoadAverages.Type
export const LoadAverages = Schema.Array(Schema.FiniteFromString)

export type CgroupPath = typeof CgroupPath.Type
export const CgroupPath = Schema.brand('DeployCgroupPath')(Schema.String)

type HistoryMinutes = typeof HistoryMinutes.Type
const HistoryMinutes = Schema.Literals([1, 10, 60, 1440, 10_080])

export type HistoryQuery = typeof HistoryQuery.Type
// The range back from now, in minutes: a minute, ten, an hour, a day or a week.
export const HistoryQuery = Schema.Struct({
	minutes: pipe(
		HistoryMinutes,
		Schema.decodeTo(Schema.Duration, {
			decode: SchemaGetter.transform(Duration.minutes),
			encode: SchemaGetter.transformEffect(range =>
				pipe(range, Duration.toMinutes, SchemaParser.decodeUnknownEffect(HistoryMinutes))
			)
		})
	)
})

export type HistoryToolInput = typeof HistoryToolInput.Type
export const HistoryToolInput = Schema.Struct({
	...HistoryQuery.fields,
	worker: Schema.OptionFromOptionalKey(WorkerId.annotate({description: 'A configured worker name.'}))
})

export type Series = typeof Series.Type
export const Series = Schema.Array(Schema.OptionFromNullOr(Schema.Finite))

export type AppUsage = typeof AppUsage.Type
export const AppUsage = Schema.Struct({
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	mib: Schema.Int,
	name: Schema.String
})

export type MachineNow = typeof MachineNow.Type
export const MachineNow = Schema.Struct({
	cpuPct: Schema.OptionFromOptionalKey(Schema.Finite),
	diskGiB: Schema.OptionFromOptionalKey(Schema.Finite),
	diskTotalGiB: Schema.OptionFromOptionalKey(Schema.Finite),
	load: Schema.OptionFromOptionalKey(Schema.Array(Schema.Finite)),
	memoryGiB: Schema.Finite,
	memoryTotalGiB: Schema.Finite
})

export type WorkerHistory = typeof WorkerHistory.Type
export const WorkerHistory = Schema.Struct({
	apps: Schema.Array(AppUsage),
	cpuPct: Series,
	diskPct: Series,
	error: Schema.OptionFromOptionalKey(Schema.String),
	from: Schema.DateTimeUtcFromString,
	memoryPct: Series,
	now: Schema.OptionFromOptionalKey(MachineNow),
	stale: Schema.OptionFromOptionalKey(Schema.Literal(true)),
	stepSeconds: DurationFromSeconds,
	worker: WorkerId
})

export type ResourceHistory = typeof ResourceHistory.Type
export const ResourceHistory = Schema.Array(WorkerHistory)

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cpuIdle: DurationFromFiniteMillis,
	cpuTotal: DurationFromFiniteMillis,
	time: DateTimeUtcFromFiniteMillis,
	uptime: DurationFromSeconds
})

export type AppSample = typeof AppSample.Type
export const AppSample = Schema.Struct({
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	id: AppId,
	memory: Schema.Finite
})

// One point of a worker's history in the series of one spacing: its readings from `since` to `time`, each averaged over the time it covers.
export class Sample extends Model.Class<Sample>('Sample')({
	// Each service or container's memory and its CPU as a share of the whole machine, from its cgroup, keyed like `itemOwner`; none where no cgroup was read, as on a Mac.
	apps: Model.FieldOption(Model.JsonFromString(Schema.Array(AppSample))),
	cpu: Model.FieldOption(Schema.Finite),
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	since: pipe(Schema.Int, Schema.decodeTo(DateTimeUtcFromFiniteMillis)),
	// The series' spacing in milliseconds: each range reads the one whose 60 slots hold a few points each.
	step: pipe(Schema.Int, Schema.decodeTo(DurationFromFiniteMillis)),
	// The machine's used space in bytes, summed over its mounted disks.
	storageUsed: Model.FieldOption(Schema.Finite),
	time: pipe(Schema.Int, Schema.decodeTo(DateTimeUtcFromFiniteMillis))
}) {
	static readonly table = 'samples'
}

export type Disk = typeof Disk.Type
export const Disk = Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	cpuModel: Schema.OptionFromOptionalKey(Schema.String),
	// The newest reading's disks and load averages, which no chart draws over time.
	disks: Schema.Array(Disk),
	error: TextFromEmpty,
	load: Schema.Array(Schema.Finite),
	samples: Schema.Array(Sample.json),
	stale: Schema.Boolean,
	time: DateTimeUtcFromFiniteMillis,
	worker: WorkerId
})
