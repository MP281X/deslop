import {Schema} from 'effect'

export type HistoryQuery = typeof HistoryQuery.Type
// The range back from now, in minutes: a minute, ten, an hour, a day or a week.
export const HistoryQuery = Schema.Struct({minutes: Schema.Literals([1, 10, 60, 1440, 10_080])})

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cores: Schema.optionalKey(
		Schema.Array(Schema.Struct({id: Schema.String, idle: Schema.Finite, total: Schema.Finite}))
	),
	cpuIdle: Schema.Finite,
	cpuTotal: Schema.Finite,
	diskRead: Schema.Finite,
	diskWrite: Schema.Finite,
	networkReceive: Schema.Finite,
	networkSend: Schema.Finite,
	time: Schema.Finite,
	uptime: Schema.Finite
})

export type Sample = typeof Sample.Type
export const Sample = Schema.Struct({
	// Each service or container's memory and its CPU as a share of the whole machine, from its cgroup, keyed like `itemOwner`.
	apps: Schema.optionalKey(
		Schema.Array(Schema.Struct({cpu: Schema.optionalKey(Schema.Finite), id: Schema.String, memory: Schema.Finite}))
	),
	cores: Schema.optionalKey(Schema.Array(Schema.Struct({id: Schema.String, usage: Schema.optionalKey(Schema.Finite)}))),
	cpu: Schema.optionalKey(Schema.Finite),
	diskRead: Schema.optionalKey(Schema.Finite),
	diskWrite: Schema.optionalKey(Schema.Finite),
	disks: Schema.Array(Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})),
	load: Schema.optionalKey(Schema.Array(Schema.Finite)),
	memoryAvailable: Schema.optionalKey(Schema.Finite),
	memoryBuffers: Schema.optionalKey(Schema.Finite),
	memoryCached: Schema.optionalKey(Schema.Finite),
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	networkReceive: Schema.optionalKey(Schema.Finite),
	networkSend: Schema.optionalKey(Schema.Finite),
	since: Schema.optionalKey(Schema.Finite),
	// The machine's used space in bytes, summed over its mounted disks.
	storageUsed: Schema.optionalKey(Schema.Finite),
	swapTotal: Schema.Finite,
	swapUsed: Schema.Finite,
	time: Schema.Finite,
	uptime: Schema.optionalKey(Schema.Finite)
})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	cpuModel: Schema.optionalKey(Schema.String),
	error: Schema.String,
	samples: Schema.Array(Sample),
	stale: Schema.Boolean,
	time: Schema.Finite,
	worker: Schema.String
})

export type MachineSummary = typeof MachineSummary.Type
export const MachineSummary = Schema.Struct({
	cpuModel: Schema.optionalKey(Schema.String),
	current: Schema.optionalKey(Sample),
	error: Schema.String,
	intervalSeconds: Schema.Finite,
	recordedSince: Schema.optionalKey(Schema.Finite),
	series: Schema.Struct({
		cpu: Schema.Array(Schema.OptionFromNullOr(Schema.Finite)),
		diskRead: Schema.Array(Schema.OptionFromNullOr(Schema.Finite)),
		diskWrite: Schema.Array(Schema.OptionFromNullOr(Schema.Finite)),
		memoryUsed: Schema.Array(Schema.Finite),
		networkReceive: Schema.Array(Schema.OptionFromNullOr(Schema.Finite)),
		networkSend: Schema.Array(Schema.OptionFromNullOr(Schema.Finite)),
		storageUsed: Schema.Array(Schema.Finite),
		swapUsed: Schema.Array(Schema.Finite),
		time: Schema.Array(Schema.Finite)
	}),
	stale: Schema.Boolean,
	time: Schema.Finite,
	worker: Schema.String
})
