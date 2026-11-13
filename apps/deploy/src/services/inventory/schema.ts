import {Array, DateTime, Effect, Function, Option, Schema, SchemaGetter, String, pipe} from 'effect'

import {SecureOrigin} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

export type WorkerId = typeof WorkerId.Type
export const WorkerId = Schema.brand('DeployWorkerId')(Schema.String)
export type ItemId = typeof ItemId.Type
export const ItemId = Schema.brand('DeployItemId')(Schema.String)
export type AppId = typeof AppId.Type
export const AppId = Schema.brand('DeployAppId')(Schema.String)
export type UnitId = typeof UnitId.Type
export const UnitId = Schema.brand('DeployUnitId')(Schema.String)
export type ProcessId = typeof ProcessId.Type
export const ProcessId = Schema.brand('DeployProcessId')(Schema.Int)
export type ContainerId = typeof ContainerId.Type
export const ContainerId = Schema.brand('DeployContainerId')(Schema.String)
export type JobName = typeof JobName.Type
export const JobName = Schema.brand('DeployJobName')(Schema.String)
export type ExposureName = typeof ExposureName.Type
export const ExposureName = Schema.brand('DeployExposureName')(Schema.String)

type ProcessIdFromString = typeof ProcessIdFromString.Type
export const ProcessIdFromString = pipe(Schema.FiniteFromString, Schema.decodeTo(ProcessId))

type CpuTicks = typeof CpuTicks.Type
export const CpuTicks = Schema.Array(Schema.FiniteFromString)

type ResidentMemoryFromKiB = typeof ResidentMemoryFromKiB.Type
export const ResidentMemoryFromKiB = pipe(
	Schema.FiniteFromString,
	Schema.decodeTo(Schema.Finite, {
		decode: SchemaGetter.transform(value => value * 1024),
		encode: SchemaGetter.transform(value => value / 1024)
	})
)

type CpuTime = typeof CpuTime.Type
export const CpuTime = Schema.Struct({
	1: Schema.OptionFromOptional(Schema.FiniteFromString),
	2: Schema.FiniteFromString,
	3: Schema.FiniteFromString
})

export type TextFromEmpty = typeof TextFromEmpty.Type
// Some collector records require a string key even when there is no value.
export const TextFromEmpty = pipe(
	Schema.String,
	Schema.decodeTo(Schema.Option(Schema.String), {
		decode: SchemaGetter.transform(value => Option.liftPredicate(value, String.isNonEmpty)),
		encode: SchemaGetter.transform(value => Option.getOrElse(value, Function.constant('')))
	})
)

type OptionalTextFromEmpty = typeof OptionalTextFromEmpty.Type
const OptionalTextFromEmpty = pipe(
	Schema.OptionFromOptionalKey(Schema.String),
	Schema.decodeTo(Schema.Option(Schema.String), {
		decode: SchemaGetter.transform(value => Option.filter(value, String.isNonEmpty)),
		encode: SchemaGetter.transform(Function.identity)
	})
)

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
	command: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	label: ProcessLabel,
	memory: Schema.Finite,
	name: Schema.String,
	parent: ProcessId,
	pid: ProcessId
})

type InventoryFields = typeof InventoryFields.Type
const InventoryFields = Schema.Struct({
	active: pipe(Schema.Boolean, Schema.withConstructorDefault(Effect.succeed(false))),
	address: pipe(Schema.OptionFromOptionalKey(Schema.String), Schema.withConstructorDefault(Effect.succeedNone)),
	bindings: pipe(
		Schema.OptionFromOptionalKey(
			Schema.Array(Schema.Struct({address: Schema.String, port: Schema.Int, protocol: Schema.Literals(['tcp', 'udp'])}))
		),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	detail: Schema.String,
	// Why a failed service stopped, and when, in epoch milliseconds.
	failure: pipe(
		Schema.OptionFromOptionalKey(
			Schema.Struct({at: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis), reason: Schema.String})
		),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	health: pipe(
		Schema.Literals(['quiet', 'warning', 'error']),
		Schema.withConstructorDefault(Effect.succeed('quiet' as const))
	),
	hostname: pipe(Schema.OptionFromOptionalKey(Schema.String), Schema.withConstructorDefault(Effect.succeedNone)),
	http: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	id: ItemId,
	kind: Schema.Literals(['service', 'container', 'port', 'exposure', 'peer']),
	links: pipe(
		Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	name: Schema.String,
	// When its timer next starts a scheduled service, in epoch milliseconds.
	next: pipe(
		Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	owned: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	port: pipe(Schema.OptionFromOptionalKey(Schema.Int), Schema.withConstructorDefault(Effect.succeedNone)),
	process: pipe(OptionalTextFromEmpty, Schema.withConstructorDefault(Effect.succeedNone)),
	processes: pipe(
		Schema.OptionFromOptionalKey(Schema.Array(Process)),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	protocol: pipe(
		Schema.OptionFromOptionalKey(Schema.Literals(['tcp', 'udp'])),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	publicAccess: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	running: pipe(Schema.Boolean, Schema.withConstructorDefault(Effect.succeed(false))),
	scheduled: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	scope: pipe(
		Schema.OptionFromOptionalKey(Schema.Literals(['user', 'system'])),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	self: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	state: Schema.String,
	ui: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	unit: pipe(
		OptionalTextFromEmpty,
		Schema.decodeTo(Schema.Option(UnitId)),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	url: TextFromEmpty,
	worker: WorkerId
})

type NonPortItem = typeof NonPortItem.Type
const NonPortItem = Schema.Union([
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literal('service'), name: UnitId})),
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literal('exposure'), name: ExposureName})),
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literals(['container', 'peer'])}))
])

type PortItem = typeof PortItem.Type
// Socket collectors always emit the process text, including an empty string when unavailable.
const PortItem = InventoryFields.mapFields(fields => ({
	...fields,
	kind: Schema.Literal('port'),
	process: pipe(
		Schema.OptionFromOptionalKey(TextFromEmpty),
		Schema.decodeTo(Schema.Option(Schema.String), {
			decode: SchemaGetter.transform(Option.flatten),
			encode: SchemaGetter.transform(Option.some)
		}),
		Schema.withConstructorDefault(Effect.succeedNone)
	)
}))

export type InventoryItem = typeof InventoryItem.Type
export const InventoryItem = Schema.Union([...NonPortItem.members, PortItem])

export type Snapshot = typeof Snapshot.Type
export const Snapshot = Schema.Struct({
	// Unlike synthesized view listeners, the collectors always send a port's unit key, even when empty.
	items: Schema.Array(
		Schema.Union([
			...NonPortItem.members,
			PortItem.mapFields(fields => ({
				...fields,
				unit: pipe(
					Schema.OptionFromOptionalKey(pipe(TextFromEmpty, Schema.decodeTo(Schema.Option(UnitId)))),
					Schema.decodeTo(Schema.Option(Schema.toType(UnitId)), {
						decode: SchemaGetter.transform(Option.flatten),
						encode: SchemaGetter.transform(Option.some)
					}),
					Schema.withConstructorDefault(Effect.succeedNone)
				)
			}))
		])
	),
	sources: Schema.Array(Schema.Struct({error: TextFromEmpty, name: Schema.String})),
	time: DateTimeUtcFromFiniteMillis,
	workers: Schema.Array(WorkerId)
})

export type Worker = typeof Worker.Type
export const Worker = Schema.Struct({name: WorkerId.check(Schema.isNonEmpty()), url: SecureOrigin})

export type WorkerList = typeof WorkerList.Type
// `--workers desktop=https://desktop.example.ts.net:5102,…`: the other workers' Deploy origins, by name.
export const WorkerList = Schema.String.check(
	Schema.isPattern(/^[\w-]+=https?:\/\/[^,=\s]+(?:,[\w-]+=https?:\/\/[^,=\s]+)*$/u),
	Schema.makeFilter(
		value =>
			pipe(
				value,
				String.split(','),
				Array.every(entry => Option.exists(pipe(entry, String.split('='), Array.get(1)), Schema.is(SecureOrigin)))
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
	Peer: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, Peer)),
	Self: Schema.OptionFromOptionalKey(Peer)
})

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

export type RunRequest = typeof RunRequest.Type
export const RunRequest = Schema.Struct({name: UnitId, scope: Schema.Literals(['system', 'user']), worker: WorkerId})

export type RunJobInput = typeof RunJobInput.Type
export const RunJobInput = Schema.Struct({
	job: JobName.annotate({description: 'A scheduled job name as list_apps shows it.'}),
	worker: Schema.OptionFromOptionalKey(WorkerId.annotate({description: 'The worker running the job, when several do.'}))
})

export type InventoryQuery = typeof InventoryQuery.Type
export const InventoryQuery = Schema.Struct({
	app: Schema.OptionFromOptionalKey(
		Schema.String.annotate({description: "A substring of an app or unit name; returns that app's process tree."})
	),
	failing: Schema.OptionFromOptionalKey(Schema.Boolean.annotate({description: 'Only failed or warning items.'})),
	worker: Schema.OptionFromOptionalKey(WorkerId.annotate({description: 'A configured worker name.'}))
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

export type App = typeof App.Type
export const App = Schema.Struct({
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
	id: ItemId,
	name: ExposureName,
	port: Schema.OptionFromOptionalKey(Schema.Int),
	url: Schema.String
})

export type WorkerInventory = typeof WorkerInventory.Type
export const WorkerInventory = Schema.Struct({
	apps: Schema.Array(App),
	errors: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	exposures: Schema.OptionFromOptionalKey(Schema.Array(HttpsExposure)),
	jobs: Schema.OptionFromOptionalKey(Schema.Array(Job)),
	worker: WorkerId
})

export type Inventory = typeof Inventory.Type
export const Inventory = Schema.Array(WorkerInventory)

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
