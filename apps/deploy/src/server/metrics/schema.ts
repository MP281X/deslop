import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {AppId, AppMeasurement, MachineSample, Process, ProcessLabel, Sample} from '#contracts'

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

const processUsageFields = Struct.pick(Process.fields, ['cpu', 'memory'])

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
