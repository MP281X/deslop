import {Command, UiSchema} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Cause, Effect, Function, Option, Predicate, Schema, String} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {needsSignIn, signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {refreshFailed} from '@deslop/ui/state'

import {AppId, ExposeInput, InventoryItem, ItemId, Snapshot, AppHour, MachineHistory} from '#contracts'

import {appHistoryAtom, inventoryAtom, metricsAtom, Operation, operationAtom} from '#web/inventory/client.ts'
import {DeployRoute} from '#web/routes.ts'

export const MACHINE = ItemId.make('machine')

const InventoryRead = AsyncResult.Schema({error: Schema.Unknown, success: Snapshot})
const MetricsRead = AsyncResult.Schema({error: Schema.Unknown, success: MachineHistory})
const AppRead = AsyncResult.Schema({error: Schema.Unknown, success: AppHour})

export type DialogState = typeof DialogState.Type
export const DialogState = Schema.TaggedUnion({
	Expose: {kind: ExposeInput.fields.kind, port: InventoryItem},
	Failure: {text: Schema.String}
})

export const NARROW = '(width < 640px) and (not (horizontal-viewport-segments: 2))'

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	admin: Schema.Boolean,
	appHistory: AppRead,
	defaultApp: Schema.Option(ItemId),
	dialog: Schema.Option(DialogState),
	effectiveApp: Schema.Option(AppId),
	inventory: InventoryRead,
	listHidden: Schema.Boolean,
	logs: Schema.Option(Schema.Result(Schema.String, Schema.String)),
	metrics: MetricsRead,
	narrow: Schema.Boolean,
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
	ExposureKind: {kind: ExposeInput.fields.kind},
	Inventory: {result: InventoryRead},
	Metrics: {result: MetricsRead},
	OpenedExposure: {port: InventoryItem},
	OpenedLogs: {id: AppId},
	Operation: {operation: Operation},
	OperationDone: {operation: Operation, text: Schema.Option(Schema.String)},
	OperationFailed: {error: Schema.String, operation: Operation},
	Posture: {narrow: Schema.Boolean},
	Retry: {},
	Route: {route: DeployRoute},
	Select: {id: ItemId},
	ToggleList: {id: Schema.Option(ItemId)}
})
export type H = Html.H<Message>

export class Execute extends Command.Service<Execute>()('Deploy/Execute', {
	args: {operation: Operation},
	success: Message
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.matchCause(
					Effect.suspend(() => {
						registry.set(operationAtom, request.operation)
						return AtomRegistry.getResult(registry, operationAtom, {suspendOnWaiting: true})
					}),
					{
						onFailure: cause => {
							const error = Cause.squash(cause)
							if (Predicate.isError(error)) {
								return Message.OperationFailed({error: error.message, operation: request.operation})
							}
							return Message.OperationFailed({error: String.String(error), operation: request.operation})
						},
						onSuccess: text => Message.OperationDone({operation: request.operation, text})
					}
				)
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
