import {Schema} from 'effect'

export type HistoryQuery = typeof HistoryQuery.Type
export const HistoryQuery = Schema.Struct({hours: Schema.Literals([1, 24, 168])})

export type Counters = typeof Counters.Type
export const Counters = Schema.Struct({
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
	cpu: Schema.optional(Schema.Finite),
	diskRead: Schema.optional(Schema.Finite),
	diskWrite: Schema.optional(Schema.Finite),
	disks: Schema.Array(Schema.Struct({mount: Schema.String, total: Schema.Finite, used: Schema.Finite})),
	memoryTotal: Schema.Finite,
	memoryUsed: Schema.Finite,
	networkReceive: Schema.optional(Schema.Finite),
	networkSend: Schema.optional(Schema.Finite),
	swapTotal: Schema.Finite,
	swapUsed: Schema.Finite,
	time: Schema.Finite
})

export type MachineHistory = typeof MachineHistory.Type
export const MachineHistory = Schema.Struct({
	error: Schema.String,
	samples: Schema.Array(Sample),
	stale: Schema.Boolean,
	time: Schema.Finite,
	worker: Schema.String
})
