import {Duration, Schema, SchemaGetter, SchemaParser, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {DeployError} from '#contracts'

import {AppId, AppRequest, Process, ProcessLabel, TextFromEmpty} from '#inventory/contract.ts'

export type BandId = typeof BandId.Type
export const BandId = Schema.Union([AppId, Schema.Literals(['other', 'system'])])

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

type Coverage = typeof Coverage.Type
// How long a point's readings of one kind were measured, in milliseconds: one second per reading, so time between `since` and `time` that went unread doesn't weigh in its average.
const Coverage = pipe(Schema.Int, Schema.decodeTo(DurationFromFiniteMillis))

// One app's measurement; its first has no CPU to difference.
export type AppMeasurement = typeof AppMeasurement.Type
export const AppMeasurement = Schema.Struct({
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	id: AppId,
	memory: Schema.Finite
})

// An app in a point: how long its CPU was measured within the point's apps coverage, which its own average weighs by.
export type AppSample = typeof AppSample.Type
export const AppSample = Schema.Struct({...AppMeasurement.fields, cpuCoverage: Coverage})

// One point of the machine's history in the series of one spacing: its readings from `since` to `time`, each averaged over the time it was measured.
export class MachineSample extends Model.Class<MachineSample>('MachineSample')({
	// Apps measured with none above the cutoff are an empty list, not an unread one.
	appsCoverage: Coverage,
	cpu: Model.FieldOption(Schema.Finite),
	cpuCoverage: Coverage,
	memoryCoverage: Coverage,
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	since: pipe(Schema.Int, Schema.decodeTo(DateTimeUtcFromFiniteMillis)),
	// The series' spacing in milliseconds: each range reads the one whose 60 slots hold a few points each.
	step: pipe(Schema.Int, Schema.decodeTo(DurationFromFiniteMillis)),
	// The machine's used space in bytes, summed over its mounted disks.
	storageCoverage: Coverage,
	storageUsed: Model.FieldOption(Schema.Finite),
	time: pipe(Schema.Int, Schema.decodeTo(DateTimeUtcFromFiniteMillis))
}) {
	static readonly table = 'samples'
}

// The chart's machine point with its app rows joined back in.
export class Sample extends Model.Class<Sample>('Sample')({
	...MachineSample.fields,
	apps: Model.FieldOption(Model.JsonFromString(Schema.Array(AppSample)))
}) {}

export type Disk = typeof Disk.Type
export const Disk = Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	// The newest reading's disks and load averages, which no chart draws over time.
	disks: Schema.Array(Disk),
	error: TextFromEmpty,
	load: Schema.Array(Schema.Finite),
	samples: Schema.Array(Sample.json),
	stale: Schema.Boolean,
	time: DateTimeUtcFromFiniteMillis
})

const processUsageFields = Struct.pick(Process.fields, ['cpu', 'memory'])

export type AppHour = typeof AppHour.Type
export const AppHour = Schema.Struct({
	processes: Schema.Array(
		Schema.Struct({
			key: Schema.String,
			label: ProcessLabel,
			samples: Schema.Array(Schema.Struct({...processUsageFields, time: DateTimeUtcFromFiniteMillis}))
		})
	),
	restarts: Schema.Array(DateTimeUtcFromFiniteMillis),
	time: DateTimeUtcFromFiniteMillis
})

export const MetricsRpcs = RpcGroup.make(
	Rpc.make('metrics.watch', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		stream: true,
		success: MachineHistory
	}),
	Rpc.make('metrics.app', {
		error: Schema.Union([AuthError, DeployError]),
		payload: AppRequest,
		stream: true,
		success: AppHour
	})
)

export type CpuCounters = typeof CpuCounters.Type
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

export type LoadAverages = typeof LoadAverages.Type
export const LoadAverages = Schema.Array(Schema.FiniteFromString)

export type CgroupPath = typeof CgroupPath.Type
export const CgroupPath = Schema.brand('DeployCgroupPath')(Schema.String)

export type MetricSeries = typeof MetricSeries.Type
export const MetricSeries = Schema.Array(Schema.OptionFromNullOr(Schema.Finite))

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

export type ResourceHistory = typeof ResourceHistory.Type
export const ResourceHistory = Schema.Struct({
	apps: Schema.Array(AppUsage),
	cpuPct: MetricSeries,
	diskPct: MetricSeries,
	error: Schema.OptionFromOptionalKey(Schema.String),
	from: Schema.DateTimeUtcFromString,
	memoryPct: MetricSeries,
	now: Schema.OptionFromOptionalKey(MachineNow),
	stale: Schema.OptionFromOptionalKey(Schema.Literal(true)),
	stepSeconds: DurationFromSeconds
})

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cpuIdle: DurationFromFiniteMillis,
	cpuTotal: DurationFromFiniteMillis,
	time: DateTimeUtcFromFiniteMillis,
	uptime: DurationFromSeconds
})

export class AppHistory extends Model.Class<AppHistory>('AppHistory')({
	app: AppId,
	cpu: Model.FieldOption(Schema.Finite),
	memory: Schema.Finite,
	since: MachineSample.fields.since,
	step: MachineSample.fields.step
}) {
	static readonly table = 'app_samples'
}

// A measurement before it joins a series: its apps are readings that have no coverage of their own yet.
export type Point = typeof Point.Type
export const Point = Schema.Struct({
	...Struct.omit(Sample.fields, ['apps', 'since', 'step']),
	apps: Schema.Option(Schema.Array(AppMeasurement))
})

export class ProcessSample extends Model.Class<ProcessSample>('ProcessSample')({
	app: AppId,
	processes: Model.JsonFromString(
		Schema.Array(Schema.Struct({...processUsageFields, key: Schema.String, label: ProcessLabel}))
	),
	time: MachineSample.fields.time
}) {
	static readonly table = 'process_samples'
}

export type MetricSource = typeof MetricSource.Type
// What the history reads or writes, each failing on its own.
export const MetricSource = Schema.Literals(['apps', 'disks', 'sample', 'save'])
