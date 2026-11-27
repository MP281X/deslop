import {Command, UiSchema} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Cause, Effect, Function, Option, Predicate, Schema, String, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {needsSignInCause} from '@deslop/runtime/client/live-stream'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {nativeSignIn, sessionAccount} from '@deslop/ui/native'
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
	Expose: {choosing: Schema.Boolean, kind: ExposeInput.fields.kind, port: InventoryItem},
	Failure: {text: Schema.String},
	Logs: {id: AppId, name: Schema.String, result: Schema.Option(Schema.Result(Schema.String, Schema.String))}
})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	admin: Schema.Boolean,
	appHistory: AppRead,
	defaultApp: Schema.Option(ItemId),
	dialog: Schema.Option(DialogState),
	effectiveApp: Schema.Option(AppId),
	// The reducer serializes host actions; the view reads the command itself.
	executing: Schema.Boolean,
	inventory: InventoryRead,
	listHidden: Schema.Boolean,
	metrics: MetricsRead,
	narrow: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	route: DeployRoute
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {admin: Schema.Boolean},
	AppHistory: {id: AppId, result: AppRead},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	ClosedDialog: {},
	ExposureKind: {kind: ExposeInput.fields.kind},
	ExposureMenu: {open: Schema.Boolean},
	Inventory: {result: InventoryRead},
	Metrics: {result: MetricsRead},
	OpenedExposure: {port: InventoryItem},
	OpenedLogs: {id: AppId, name: Schema.String},
	Operation: {operation: Operation},
	OperationDone: {operation: Operation, text: Schema.Option(Schema.String)},
	OperationFailed: {error: Schema.String, operation: Operation},
	Posture: {narrow: Schema.Boolean},
	Retry: {},
	Route: {route: DeployRoute},
	Select: {id: ItemId},
	Sidebar: {},
	SignIn: {}
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

function refreshReads(registry: AtomRegistry.AtomRegistry, id: Option.Option<AppId>) {
	refreshFailed(registry, inventoryAtom)
	refreshFailed(registry, metricsAtom)
	Option.match(id, {onNone: Function.constVoid, onSome: app => refreshFailed(registry, appHistoryAtom(app))})
}

export class Refresh extends Command.Service<Refresh>()('Deploy/Refresh', {
	args: {id: Schema.Option(AppId)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry => request => Effect.sync(() => refreshReads(registry, request.id)))
	)
}

export const RedirectToAuth = Command.make('Deploy/RedirectToAuth', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)

export class SignIn extends Command.Service<SignIn>()('Deploy/SignIn', {
	args: {id: Schema.Option(AppId)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				pipe(
					nativeSignIn,
					Effect.flatMap(signedIn => {
						if (!signedIn) return Effect.void
						return Effect.sync(() => {
							registry.refresh(sessionAccount)
							refreshReads(registry, request.id)
						})
					}),
					Effect.ignore({log: 'Warn'})
				)
		)
	)
}

export function signInRequested(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return AsyncResult.isFailure(result) && needsSignInCause(result.cause)
}
