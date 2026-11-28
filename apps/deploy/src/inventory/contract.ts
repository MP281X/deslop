import {DateTime, Effect, Function, Option, Schema, SchemaGetter, String, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAdmin} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {DeployError} from '#machine/contract.ts'

export type ItemId = typeof ItemId.Type
export const ItemId = Schema.brand('DeployItemId')(Schema.String)
export type AppId = typeof AppId.Type
export const AppId = Schema.brand('DeployAppId')(Schema.String)
export type UnitId = typeof UnitId.Type
export const UnitId = Schema.brand('DeployUnitId')(Schema.String)
export type ProcessId = typeof ProcessId.Type
export const ProcessId = Schema.brand('DeployProcessId')(Schema.Int)
export type ExposureName = typeof ExposureName.Type
export const ExposureName = Schema.brand('DeployExposureName')(Schema.String)

type TextFromEmpty = typeof TextFromEmpty.Type
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

export type ProcessLabel = typeof ProcessLabel.Type
export const ProcessLabel = Schema.Struct({
	// What the process is, readable: its program or app name and the few arguments that say which one.
	detail: Schema.String,
	name: Schema.String
})

export type Process = typeof Process.Type
export const Process = Schema.Struct({
	cpu: Schema.OptionFromOptionalKey(Schema.Finite),
	label: ProcessLabel,
	memory: Schema.Finite,
	name: Schema.String,
	parent: ProcessId,
	pid: ProcessId
})

export type ServiceScope = typeof ServiceScope.Type
// Which systemd manager runs a unit.
export const ServiceScope = Schema.Literals(['user', 'system'])

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
	scope: pipe(Schema.OptionFromOptionalKey(ServiceScope), Schema.withConstructorDefault(Effect.succeedNone)),
	self: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	state: Schema.String,
	ui: pipe(Schema.OptionFromOptionalKey(Schema.Boolean), Schema.withConstructorDefault(Effect.succeedNone)),
	unit: pipe(
		OptionalTextFromEmpty,
		Schema.decodeTo(Schema.Option(UnitId)),
		Schema.withConstructorDefault(Effect.succeedNone)
	),
	url: TextFromEmpty
})

type NonPortItem = typeof NonPortItem.Type
const NonPortItem = Schema.Union([
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literal('service'), name: UnitId})),
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literal('exposure'), name: ExposureName})),
	InventoryFields.mapFields(fields => ({...fields, kind: Schema.Literals(['container', 'peer'])}))
])

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
	time: DateTimeUtcFromFiniteMillis
})

export type RunRequest = typeof RunRequest.Type
export const RunRequest = Schema.Struct({name: UnitId, scope: ServiceScope})

export type AppRequest = typeof AppRequest.Type
export const AppRequest = Schema.Struct({id: AppId})

export const InventoryRpcs = RpcGroup.make(
	Rpc.make('inventory.watch', {error: Schema.Union([AuthError, DeployError]), stream: true, success: Snapshot}),
	Rpc.make('inventory.logs', {
		error: Schema.Union([AuthError, DeployError]),
		payload: AppRequest,
		success: Schema.String
	}).middleware(RpcAdmin),
	Rpc.make('inventory.restart', {error: Schema.Union([AuthError, DeployError]), payload: AppRequest}).middleware(
		RpcAdmin
	),
	Rpc.make('inventory.stop', {error: Schema.Union([AuthError, DeployError]), payload: AppRequest}).middleware(RpcAdmin),
	Rpc.make('inventory.run', {error: Schema.Union([AuthError, DeployError]), payload: RunRequest}).middleware(RpcAdmin)
)

export type JobName = typeof JobName.Type
export const JobName = Schema.brand('DeployJobName')(Schema.String)

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

export type ProcessIdFromString = typeof ProcessIdFromString.Type
export const ProcessIdFromString = pipe(Schema.FiniteFromString, Schema.decodeTo(ProcessId))

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

export const APP_LIFECYCLE_MESSAGES = [
	'39f53479d3a045ac8e11786248231fbf',
	'9d1aaa27d60140bd96365438aad20286',
	'5eb034946b58470ab5a336b33729d08b'
] as const

export type AppLifecycleEvent = typeof AppLifecycleEvent.Type
export const AppLifecycleEvent = Schema.fromJsonString(
	Schema.Struct({
		__REALTIME_TIMESTAMP: Schema.FiniteFromString,
		_BOOT_ID: Schema.NonEmptyString,
		MESSAGE_ID: Schema.Literals(APP_LIFECYCLE_MESSAGES),
		USER_INVOCATION_ID: Schema.optional(Schema.String)
	})
)
