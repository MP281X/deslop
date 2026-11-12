import {Array, Option, Schema, String} from 'effect'

import {SecureOrigin} from '@deslop/runtime/shared/schema'

export class DeployError extends Schema.TaggedError<DeployError>()('DeployError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type ProcessLabel = typeof ProcessLabel.Type
export const ProcessLabel = Schema.Struct({
	// What the process is, readable: its program or app name and the few arguments that say which one.
	detail: Schema.String,
	name: Schema.String
})

export type Process = typeof Process.Type
export const Process = Schema.Struct({
	// Its arguments, the executable first, with anything that looks like a secret masked.
	command: Schema.optionalKey(Schema.Array(Schema.String)),
	cpu: Schema.optionalKey(Schema.Finite),
	label: ProcessLabel,
	memory: Schema.Finite,
	name: Schema.String,
	parent: Schema.Int,
	pid: Schema.Int
})

export type InventoryItem = typeof InventoryItem.Type
export const InventoryItem = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	bindings: Schema.optionalKey(
		Schema.Array(Schema.Struct({address: Schema.String, port: Schema.Int, protocol: Schema.Literals(['tcp', 'udp'])}))
	),
	detail: Schema.String,
	// Why a failed service stopped, and when, in epoch milliseconds.
	failure: Schema.optionalKey(Schema.Struct({at: Schema.optionalKey(Schema.Finite), reason: Schema.String})),
	hostname: Schema.optionalKey(Schema.String),
	http: Schema.optionalKey(Schema.Boolean),
	id: Schema.String,
	kind: Schema.Literals(['service', 'container', 'port', 'exposure', 'peer']),
	links: Schema.optionalKey(Schema.Array(Schema.String)),
	name: Schema.String,
	// When its timer next starts a scheduled service, in epoch milliseconds.
	next: Schema.optionalKey(Schema.Finite),
	owned: Schema.optionalKey(Schema.Boolean),
	port: Schema.optionalKey(Schema.Int),
	process: Schema.optionalKey(Schema.String),
	processes: Schema.optionalKey(Schema.Array(Process)),
	protocol: Schema.optionalKey(Schema.Literals(['tcp', 'udp'])),
	publicAccess: Schema.optionalKey(Schema.Boolean),
	scheduled: Schema.optionalKey(Schema.Boolean),
	scope: Schema.optionalKey(Schema.Literals(['user', 'system'])),
	self: Schema.optionalKey(Schema.Boolean),
	state: Schema.String,
	ui: Schema.optionalKey(Schema.Boolean),
	unit: Schema.optionalKey(Schema.String),
	url: Schema.String,
	worker: Schema.String
})

export type Snapshot = typeof Snapshot.Type
export const Snapshot = Schema.Struct({
	items: Schema.Array(InventoryItem),
	sources: Schema.Array(Schema.Struct({error: Schema.String, name: Schema.String})),
	time: Schema.Finite,
	workers: Schema.optionalKey(Schema.Array(Schema.String))
})

export type Worker = typeof Worker.Type
export const Worker = Schema.Struct({name: Schema.NonEmptyString, url: SecureOrigin})

export type WorkerList = typeof WorkerList.Type
// `--workers desktop=https://desktop.example.ts.net:5102,…`: the other workers' Deploy origins, by name.
export const WorkerList = Schema.String.check(
	Schema.isPattern(/^[\w-]+=https?:\/\/[^,=\s]+(?:,[\w-]+=https?:\/\/[^,=\s]+)*$/u),
	Schema.makeFilter(
		value =>
			Array.every(String.split(value, ','), entry =>
				Option.exists(Array.get(String.split(entry, '='), 1), Schema.is(SecureOrigin))
			),
		{expected: 'named HTTPS origins, or loopback HTTP origins'}
	)
)

export type Peer = typeof Peer.Type
export const Peer = Schema.Struct({
	DNSName: Schema.String,
	HostName: Schema.String,
	OS: Schema.String,
	Online: Schema.Boolean,
	TailscaleIPs: Schema.Array(Schema.String)
})

export type Tailnet = typeof Tailnet.Type
export const Tailnet = Schema.Struct({
	Peer: Schema.optionalKey(Schema.Record(Schema.String, Peer)),
	Self: Schema.optionalKey(Peer)
})

export type Serve = typeof Serve.Type
export const Serve = Schema.Struct({
	AllowFunnel: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
	TCP: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
	Web: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({Handlers: Schema.Record(Schema.String, Schema.Struct({Proxy: Schema.optionalKey(Schema.String)}))})
		)
	)
})

export type Exposure = typeof Exposure.Type
export const Exposure = Schema.Struct({
	hostname: Schema.String.check(
		Schema.isMaxLength(253),
		Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
	),
	kind: Schema.Literals(['tailnet', 'public']),
	name: Schema.NonEmptyString.check(Schema.isMaxLength(260)),
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024})),
	publicAccess: Schema.Boolean
})

export type ExposeRequest = typeof ExposeRequest.Type
export const ExposeRequest = Schema.Struct({...Exposure.fields, target: Schema.optionalKey(Schema.String)})

export type HideRequest = typeof HideRequest.Type
export const HideRequest = Schema.Struct({name: Schema.String, target: Schema.optionalKey(Schema.String)})

export type RunRequest = typeof RunRequest.Type
export const RunRequest = Schema.Struct({
	name: Schema.String,
	scope: Schema.Literals(['system', 'user']),
	target: Schema.optionalKey(Schema.String)
})

export type RunJobInput = typeof RunJobInput.Type
export const RunJobInput = Schema.Struct({
	job: Schema.String.annotate({description: 'A scheduled job name as list_apps shows it.'}),
	worker: Schema.optionalKey(Schema.String.annotate({description: 'The worker running the job, when several do.'}))
})

export type ListAppsInput = typeof ListAppsInput.Type
export const ListAppsInput = Schema.Struct({
	app: Schema.optionalKey(
		Schema.String.annotate({description: "A substring of an app or unit name; returns that app's process tree."})
	),
	failing: Schema.optionalKey(Schema.Boolean.annotate({description: 'Only failed or warning items.'})),
	worker: Schema.optionalKey(Schema.String.annotate({description: 'A configured worker name.'}))
})

export type ProcessSummary = {
	children?: readonly ProcessSummary[]
	cpu?: number
	detail?: string
	mib: number
	name: string
}
export const ProcessSummary = Schema.Struct({
	children: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Codec<ProcessSummary> => ProcessSummary))),
	cpu: Schema.optionalKey(Schema.Finite),
	detail: Schema.optionalKey(Schema.String),
	mib: Schema.Int,
	name: Schema.String
})

export type ListApp = typeof ListApp.Type
export const ListApp = Schema.Struct({
	failure: Schema.optionalKey(Schema.String),
	name: Schema.String,
	ports: Schema.optionalKey(Schema.Array(Schema.Int)),
	processes: Schema.optionalKey(Schema.Array(ProcessSummary)),
	since: Schema.optionalKey(Schema.String),
	state: Schema.String,
	url: Schema.optionalKey(Schema.String)
})

export type ListJob = typeof ListJob.Type
export const ListJob = Schema.Struct({
	failure: Schema.optionalKey(Schema.String),
	name: Schema.String,
	next: Schema.optionalKey(Schema.String),
	since: Schema.optionalKey(Schema.String)
})

export type ListExposure = typeof ListExposure.Type
export const ListExposure = Schema.Struct({
	access: Schema.Literals(['tailnet', 'public']),
	name: Schema.String,
	port: Schema.optionalKey(Schema.Int),
	url: Schema.String
})

export type WorkerApps = typeof WorkerApps.Type
export const WorkerApps = Schema.Struct({
	apps: Schema.Array(ListApp),
	errors: Schema.optionalKey(Schema.Array(Schema.String)),
	exposures: Schema.optionalKey(Schema.Array(ListExposure)),
	jobs: Schema.optionalKey(Schema.Array(ListJob)),
	worker: Schema.String
})

export type ListApps = typeof ListApps.Type
export const ListApps = Schema.Array(WorkerApps)

export type Timer = typeof Timer.Type
// `next` is in epoch microseconds.
export const Timer = Schema.Struct({activates: Schema.NullOr(Schema.String), next: Schema.NullOr(Schema.Finite)})

export type Unit = typeof Unit.Type
export const Unit = Schema.Struct({
	active: Schema.String,
	description: Schema.String,
	sub: Schema.String,
	unit: Schema.String
})

export type Container = typeof Container.Type
export const Container = Schema.Struct({
	ID: Schema.String,
	Labels: Schema.optionalKey(Schema.String),
	Names: Schema.String,
	Ports: Schema.String,
	State: Schema.String,
	Status: Schema.String
})
