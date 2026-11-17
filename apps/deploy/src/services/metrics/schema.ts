import {Duration, Schema, SchemaGetter, SchemaParser, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {AppId, TextFromEmpty, WorkerId} from '#services/inventory/schema.ts'

export type BandId = typeof BandId.Type
export const BandId = Schema.Union([AppId, Schema.Literals(['other', 'system'])])
export type CpuTime = typeof CpuTime.Type
const CpuTime = Schema.Literals(['idle', 'irq', 'nice', 'sys', 'user'])

type CpuCounters = typeof CpuCounters.Type
export const CpuCounters = Schema.TupleWithRest(
	Schema.Tuple([
		Schema.FiniteFromString,
		Schema.FiniteFromString,
		Schema.FiniteFromString,
		Schema.FiniteFromString,
		Schema.FiniteFromString
	]),
	[Schema.FiniteFromString]
)

type LoadAverages = typeof LoadAverages.Type
export const LoadAverages = Schema.Array(Schema.FiniteFromString)

export type CgroupPath = typeof CgroupPath.Type
export const CgroupPath = Schema.brand('DeployCgroupPath')(Schema.String)

export type HistoryMinutes = typeof HistoryMinutes.Type
export const HistoryMinutes = Schema.Literals([10, 60, 1440, 10_080, 43_200])

export type HistoryQuery = typeof HistoryQuery.Type
// The shared time frames, encoded in minutes for the URL and metrics queries.
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

const Series = Schema.Array(Schema.OptionFromNullOr(Schema.Finite))

export type AppUsage = typeof AppUsage.Type
const AppUsage = Schema.Struct({cpu: Schema.OptionFromOptionalKey(Schema.Finite), mib: Schema.Int, name: Schema.String})

const MachineNow = Schema.Struct({
	cpuPct: Schema.OptionFromOptionalKey(Schema.Finite),
	diskGiB: Schema.OptionFromOptionalKey(Schema.Finite),
	diskTotalGiB: Schema.OptionFromOptionalKey(Schema.Finite),
	load: Schema.OptionFromOptionalKey(Schema.Array(Schema.Finite)),
	memoryGiB: Schema.Finite,
	memoryTotalGiB: Schema.Finite
})

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

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cpuIdle: DurationFromFiniteMillis,
	cpuTotal: DurationFromFiniteMillis,
	time: DateTimeUtcFromFiniteMillis,
	uptime: DurationFromSeconds
})

export type AppSample = typeof AppSample.Type
const AppSample = Schema.Struct({cpu: Schema.OptionFromOptionalKey(Schema.Finite), id: AppId, memory: Schema.Finite})

// One point of a worker's history in the series of one spacing: its readings from `since` to `time`, each averaged over the time it covers.
export class MachineSample extends Model.Class<MachineSample>('MachineSample')({
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

export class AppHistory extends Model.Class<AppHistory>('AppHistory')({
	app: AppId,
	cpu: Model.FieldOption(Schema.Finite),
	memory: Schema.Finite,
	since: MachineSample.fields.since,
	step: MachineSample.fields.step
}) {
	static readonly table = 'app_samples'
}

// The chart's machine point with its app rows joined back in; a Mac has no app rows.
export class Sample extends Model.Class<Sample>('Sample')({
	...MachineSample.fields,
	apps: Model.FieldOption(Model.JsonFromString(Schema.Array(AppSample)))
}) {}

export type Point = typeof Point.Type
const Point = Schema.Struct(Struct.omit(Sample.fields, ['since', 'step']))

export type Disk = typeof Disk.Type
const Disk = Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})

export type Platform = typeof Platform.Type
const Platform = Schema.Literals(['linux', 'darwin'])

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	// The newest reading's disks and load averages, which no chart draws over time.
	disks: Schema.Array(Disk),
	error: TextFromEmpty,
	load: Schema.Array(Schema.Finite),
	platform: Schema.OptionFromOptionalKey(Platform),
	samples: Schema.Array(Sample.json),
	stale: Schema.Boolean,
	time: DateTimeUtcFromFiniteMillis,
	worker: WorkerId
})

// The `vm_stat` counters used memory needs; one missing fails the sample instead of reading as zero memory.
export const VmStatPages = Schema.Struct({
	'Anonymous pages': Schema.FiniteFromString,
	'Pages occupied by compressor': Schema.FiniteFromString,
	'Pages purgeable': Schema.FiniteFromString,
	'Pages wired down': Schema.FiniteFromString
})
