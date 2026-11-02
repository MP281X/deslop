import {Schema} from 'effect'

export type HistoryQuery = typeof HistoryQuery.Type
export const HistoryQuery = Schema.Struct({hours: Schema.Literals([1, 24, 168])})

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
	cores: Schema.optional(Schema.Array(Schema.Struct({id: Schema.String, idle: Schema.Finite, total: Schema.Finite}))),
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
	cores: Schema.optional(Schema.Array(Schema.Struct({id: Schema.String, usage: Schema.optional(Schema.Finite)}))),
	cpu: Schema.optional(Schema.Finite),
	diskRead: Schema.optional(Schema.Finite),
	diskWrite: Schema.optional(Schema.Finite),
	disks: Schema.Array(Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})),
	load: Schema.optional(Schema.Array(Schema.Finite)),
	memoryAvailable: Schema.optional(Schema.Finite),
	memoryBuffers: Schema.optional(Schema.Finite),
	memoryCached: Schema.optional(Schema.Finite),
	memoryFree: Schema.optional(Schema.Finite),
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	networkReceive: Schema.optional(Schema.Finite),
	networkSend: Schema.optional(Schema.Finite),
	since: Schema.optional(Schema.Finite),
	swapTotal: Schema.Finite,
	swapUsed: Schema.Finite,
	time: Schema.Finite,
	uptime: Schema.optional(Schema.Finite)
})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	cpuModel: Schema.optional(Schema.String),
	error: Schema.String,
	samples: Schema.Array(Sample),
	stale: Schema.Boolean,
	time: Schema.Finite,
	worker: Schema.String
})

export type MachineSummary = typeof MachineSummary.Type
export const MachineSummary = Schema.Struct({
	cpuModel: Schema.optional(Schema.String),
	current: Schema.optional(Sample),
	error: Schema.String,
	intervalSeconds: Schema.Finite,
	recordedSince: Schema.optional(Schema.Finite),
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
