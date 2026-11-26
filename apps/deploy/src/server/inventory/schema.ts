import type {Option} from 'effect'
import {DateTime, Schema, SchemaGetter, pipe} from 'effect'

import {ItemId, ProcessId, UnitId, ExposureName} from '#contracts'

export const APP_LIFECYCLE_MESSAGES = [
	'39f53479d3a045ac8e11786248231fbf',
	'9d1aaa27d60140bd96365438aad20286',
	'5eb034946b58470ab5a336b33729d08b'
] as const

export type ContainerId = typeof ContainerId.Type
export const ContainerId = Schema.brand('DeployContainerId')(Schema.String)
export type JobName = typeof JobName.Type
export const JobName = Schema.brand('DeployJobName')(Schema.String)

export type ProcessIdFromString = typeof ProcessIdFromString.Type
export const ProcessIdFromString = pipe(Schema.FiniteFromString, Schema.decodeTo(ProcessId))

export type CpuTicks = typeof CpuTicks.Type
export const CpuTicks = Schema.Array(Schema.FiniteFromString)

export type ResidentMemoryFromKiB = typeof ResidentMemoryFromKiB.Type
export const ResidentMemoryFromKiB = pipe(
	Schema.FiniteFromString,
	Schema.decodeTo(Schema.Finite, {
		decode: SchemaGetter.transform(value => value * 1024),
		encode: SchemaGetter.transform(value => value / 1024)
	})
)

export type Peer = typeof Peer.Type
export const Peer = Schema.Struct({
	DNSName: Schema.String,
	HostName: Schema.String,
	OS: Schema.String,
	Online: Schema.Boolean,
	TailscaleIPs: Schema.Array(Schema.String)
})

export type TailnetStatus = typeof TailnetStatus.Type
export const TailnetStatus = Schema.Struct({Self: Schema.OptionFromOptionalKey(Peer)})

export type Serve = typeof Serve.Type
export const Serve = Schema.Struct({
	AllowFunnel: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, Schema.Boolean)),
	TCP: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, Schema.Json)),
	Web: Schema.OptionFromOptionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				Handlers: Schema.Record(Schema.String, Schema.Struct({Proxy: Schema.OptionFromOptionalKey(Schema.String)}))
			})
		)
	)
})

export type AppAction = typeof AppAction.Type
export const AppAction = Schema.Literals(['restart', 'stop'])

export type AppLifecycleEvent = typeof AppLifecycleEvent.Type
export const AppLifecycleEvent = Schema.fromJsonString(
	Schema.Struct({
		__REALTIME_TIMESTAMP: Schema.FiniteFromString,
		_BOOT_ID: Schema.NonEmptyString,
		MESSAGE_ID: Schema.Literals(APP_LIFECYCLE_MESSAGES),
		USER_INVOCATION_ID: Schema.optional(Schema.String)
	})
)

export type RunJobInput = typeof RunJobInput.Type
export const RunJobInput = Schema.Struct({
	id: ItemId.annotate({description: 'A scheduled job’s id as list_apps shows it.'})
})

export type InventoryCursor = typeof InventoryCursor.Type
// Where a list_apps page ended: its section and row, as JSON so no name can collide with a separator. The inventory is live, so rows can come and go between pages.
export const InventoryCursor = Schema.fromJsonString(
	Schema.Tuple([Schema.Literals(['apps', 'exposures', 'jobs']), ItemId])
)

export type InventoryQuery = typeof InventoryQuery.Type
export const InventoryQuery = Schema.Struct({
	app: Schema.OptionFromOptionalKey(
		Schema.String.annotate({description: "A substring of an app or unit name; returns that app's process tree."})
	),
	failing: Schema.OptionFromOptionalKey(Schema.Boolean.annotate({description: 'Only failed or warning items.'}))
})

type ProcessSummaryEncoded = {
	children?: readonly ProcessSummaryEncoded[]
	cpu?: number
	detail?: string
	mib: number
	name: string
}
export type ProcessSummary = {
	children: Option.Option<readonly ProcessSummary[]>
	cpu: Option.Option<number>
	detail: Option.Option<string>
	mib: number
	name: string
}
export const ProcessSummary = Schema.Struct({
	children: Schema.OptionFromOptionalKey(
		Schema.Array(Schema.suspend((): Schema.Codec<ProcessSummary, ProcessSummaryEncoded> => ProcessSummary))
	),
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	detail: Schema.OptionFromOptionalKey(Schema.String),
	mib: Schema.Int,
	name: Schema.String
})

export type ManagedApp = typeof ManagedApp.Type
export const ManagedApp = Schema.Struct({
	failure: Schema.OptionFromOptionalKey(Schema.String),
	id: ItemId,
	name: Schema.String,
	ports: Schema.OptionFromOptionalKey(Schema.Array(Schema.Int)),
	processes: Schema.OptionFromOptionalKey(Schema.Array(ProcessSummary)),
	since: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
	state: Schema.String,
	url: Schema.OptionFromOptionalKey(Schema.String)
})

export type Job = typeof Job.Type
export const Job = Schema.Struct({
	failure: Schema.OptionFromOptionalKey(Schema.String),
	id: ItemId,
	name: JobName,
	next: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
	running: Schema.Boolean,
	since: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString)
})

export type HttpsExposure = typeof HttpsExposure.Type
export const HttpsExposure = Schema.Struct({
	access: Schema.Literals(['tailnet', 'public']),
	// Why the machine does not yet serve it as saved: a removal still finishing, a failed change Deploy retries, or a port that changed owner.
	failure: Schema.OptionFromOptionalKey(Schema.String),
	id: ItemId,
	name: ExposureName,
	port: Schema.OptionFromOptionalKey(Schema.Int),
	url: Schema.String
})

export type AppList = typeof AppList.Type
export const AppList = Schema.Struct({
	apps: Schema.Array(ManagedApp),
	errors: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	exposures: Schema.OptionFromOptionalKey(Schema.Array(HttpsExposure)),
	jobs: Schema.OptionFromOptionalKey(Schema.Array(Job))
})

export type Timer = typeof Timer.Type
// `next` is in epoch microseconds.
export const Timer = Schema.Struct({
	activates: Schema.OptionFromNullOr(UnitId),
	next: Schema.OptionFromNullOr(
		pipe(
			Schema.Finite,
			Schema.decodeTo(Schema.DateTimeUtc, {
				decode: SchemaGetter.transform(value => DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => value / 1000)),
				encode: SchemaGetter.transform(value => DateTime.toEpochMillis(value) * 1000)
			})
		)
	)
})

export type Unit = typeof Unit.Type
export const Unit = Schema.Struct({active: Schema.String, description: Schema.String, sub: Schema.String, unit: UnitId})

export type Container = typeof Container.Type
export const Container = Schema.Struct({
	ID: ContainerId,
	Labels: Schema.OptionFromOptionalKey(Schema.String),
	Names: Schema.String,
	Ports: Schema.String,
	State: Schema.String,
	Status: Schema.String
})
