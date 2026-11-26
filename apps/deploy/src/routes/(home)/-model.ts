import {Command, Route, UiSchema} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Cause, Effect, Function, Option, Predicate, Schema, String} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {needsSignIn, signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {refreshFailed} from '@deslop/ui/state'

import {appHistoryAtom, execute, inventoryAtom, metricsAtom, Operation} from '#lib/machine.ts'
import {AppId, InventoryItem, ItemId, Snapshot} from '#services/inventory/schema.ts'
import {AppHour, MachineHistory} from '#services/metrics/schema.ts'

export const DeployRoute = Route.union({
	Home: Route.make('/', {
		search: {app: Schema.optional(ItemId), pane: Schema.optional(Schema.Literals(['apps', 'process']))}
	}),
	NotFound: Route.make('/*')
})

export type ExposureKind = typeof ExposureKind.Type
export const ExposureKind = Schema.Literals(['tailnet', 'public'])
export const MACHINE = ItemId.make('machine')

const InventoryRead = AsyncResult.Schema({error: Schema.Unknown, success: Snapshot})
const MetricsRead = AsyncResult.Schema({error: Schema.Unknown, success: MachineHistory})
const AppRead = AsyncResult.Schema({error: Schema.Unknown, success: AppHour})

export type DialogState = typeof DialogState.Type
export const DialogState = Schema.TaggedUnion({
	Expose: {kind: ExposureKind, port: InventoryItem},
	Failure: {text: Schema.String},
	Logs: {name: Schema.String, text: Schema.Option(Schema.String)}
})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	admin: Schema.Boolean,
	appHistory: AppRead,
	defaultApp: Schema.Option(ItemId),
	dialog: Schema.Option(DialogState),
	effectiveApp: Schema.Option(AppId),
	inventory: InventoryRead,
	listHidden: Schema.Boolean,
	metrics: MetricsRead,
	now: DateTimeUtcFromFiniteMillis,
	pending: Schema.Boolean,
	route: DeployRoute
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {admin: Schema.Boolean},
	AppHistory: {id: AppId, result: AppRead},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	ClosedDialog: {},
	ExposureKind: {kind: ExposureKind},
	Inventory: {result: InventoryRead},
	Metrics: {result: MetricsRead},
	OpenedExposure: {port: InventoryItem},
	OpenedLogs: {id: AppId, name: Schema.String},
	Operation: {operation: Operation},
	OperationDone: {operation: Operation, text: Schema.Option(Schema.String)},
	OperationFailed: {error: Schema.String},
	Retry: {},
	Route: {route: DeployRoute},
	Select: {id: ItemId},
	ShowList: {id: Schema.Option(ItemId)},
	ToggleList: {}
})
export type H = Html.H<Message>

function describe(error: unknown) {
	if (Predicate.isError(error)) return error.message
	return String.String(error)
}

export class Execute extends Command.Service<Execute>()('Deploy/Execute', {
	args: {operation: Operation},
	success: Message
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.matchCause(execute(registry, request.operation), {
					onFailure: cause => Message.OperationFailed({error: describe(Cause.squash(cause))}),
					onSuccess: text => Message.OperationDone({operation: request.operation, text})
				})
		)
	)
}

export class Refresh extends Command.Service<Refresh>()('Deploy/Refresh', {
	args: {id: Schema.Option(AppId)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.sync(() => {
					refreshFailed(registry, inventoryAtom)
					refreshFailed(registry, metricsAtom)
					Option.match(request.id, {
						onNone: Function.constVoid,
						onSome: id => refreshFailed(registry, appHistoryAtom(id))
					})
				})
		)
	)
}

export const SignIn = Command.make('Deploy/SignIn', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)

export function signInRequested(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return AsyncResult.isFailure(result) && needsSignIn(Cause.squash(result.cause))
}
