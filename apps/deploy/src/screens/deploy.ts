import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Boolean, DateTime, Equal, Function, Option, Predicate, Result, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/design/model'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {
	AppHour,
	AppId,
	ExposeInput,
	ExposureName,
	InventoryItem,
	ItemId,
	MachineHistory,
	Snapshot,
	workloadName,
	workloads
} from '#contracts'

import {appDetail, listItem, loadAverages, machineDetail, ownerOf, restartReason, runJob} from '#screens/detail.ts'
import {Authenticate, Execute, OpenEndpoint, Operation, Refresh, observe, readDeploy} from '#screens/reads.ts'
import {DeployRoute, appOf, isDetail} from '#screens/routes.ts'
import {machineHost, rowOrder, shown} from '#screens/rows.ts'

export const MACHINE = ItemId.make('machine')

const InventoryRead = AsyncResult.Schema({error: Schema.Unknown, success: Snapshot})
const MetricsRead = AsyncResult.Schema({error: Schema.Unknown, success: MachineHistory})
const AppRead = AsyncResult.Schema({error: Schema.Unknown, success: AppHour})

const Dialog = Schema.TaggedUnion({
	Expose: {hostname: Schema.String, kind: ExposeInput.fields.kind, port: InventoryItem},
	Failure: {text: Schema.String},
	Logs: {id: AppId, name: Schema.String, result: Schema.Option(Schema.Result(Schema.String, Schema.String))}
})
type Dialog = typeof Dialog.Type

const Model = Schema.Struct({
	admin: Schema.Boolean,
	appHistory: AppRead,
	authError: Schema.Option(Schema.String),
	defaultApp: Schema.Option(ItemId),
	dialog: Schema.Option(Dialog),
	effectiveApp: Schema.Option(AppId),
	executing: Schema.Boolean,
	hasListBehind: Schema.Boolean,
	inventory: InventoryRead,
	metrics: MetricsRead,
	now: DateTimeUtcFromFiniteMillis,
	redirected: Schema.Boolean,
	route: DeployRoute
})
type Model = typeof Model.Type

const Message = UiSchema.TaggedEnum({
	Account: {admin: Schema.Boolean},
	AppHistory: {id: AppId, result: AppRead},
	Back: {},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	ClosedDialog: {},
	Expose: {},
	ExposureKind: {kind: ExposeInput.fields.kind},
	Hostname: {value: Schema.String},
	Inventory: {result: InventoryRead},
	Metrics: {result: MetricsRead},
	OpenedExposure: {port: InventoryItem},
	OpenedUrl: {url: Schema.String},
	OpenedLogs: {id: AppId, name: Schema.String},
	Operation: {operation: Operation},
	OperationDone: {operation: Operation, text: Schema.Option(Schema.String)},
	OperationFailed: {error: Schema.String, operation: Operation},
	Retry: {},
	Route: {route: DeployRoute},
	Select: {id: ItemId},
	SignIn: {},
	SignInFailed: {text: Schema.String},
	SignedIn: {signedIn: Schema.Boolean}
})
type Message = typeof Message.Type

function rowsOf(inventory: Model['inventory']) {
	return pipe(
		AsyncResult.value(inventory),
		Option.map(snapshot => Array.sort(workloads(snapshot.items), rowOrder)),
		Option.getOrElse(Array.empty)
	)
}

function moveTo(inventory: Model['inventory'], route: DeployRoute, current: Model) {
	const rows = rowsOf(inventory)
	const defaultApp = Option.orElse(current.defaultApp, () =>
		pipe(
			rows,
			Array.findFirst(row => !Option.contains(row.item.scheduled, true)),
			Option.map(row => row.item.id)
		)
	)
	const id = appOf(route) ?? Option.getOrUndefined(defaultApp)
	const effectiveApp = pipe(
		rows,
		Array.findFirst(row => row.item.id === id),
		Option.flatMap(row => ownerOf(row.item))
	)
	return {
		...current,
		appHistory: Equal.equals(current.effectiveApp, effectiveApp) ? current.appHistory : AsyncResult.initial(),
		defaultApp,
		effectiveApp,
		inventory,
		route
	}
}

function authenticate() {
	return pipe(
		Authenticate.make({}),
		Command.match({
			onFailure: error => Message.SignInFailed({text: error.message}),
			onSuccess: signedIn => Message.SignedIn({signedIn})
		})
	)
}

type Read = AsyncResult.AsyncResult<unknown, unknown>
function signInRequested(result: Read) {
	return AsyncResult.isFailure(result) && needsSignInCause(result.cause)
}

function completeRead(next: Component.Step<Model, Message, never>, read: Read, autoSignIn: boolean) {
	if (autoSignIn && !next.model.redirected && signInRequested(read)) {
		return next.evolve({redirected: true}).run(authenticate())
	}
	return next
}

function execute(operation: Operation) {
	return pipe(
		Execute.make({operation}),
		Command.match({
			onFailure: error => Message.OperationFailed({error, operation}),
			onSuccess: text => Message.OperationDone({operation, text})
		})
	)
}

function settleOperation(
	$: Component.Step<Model, Message, never>,
	operation: Operation,
	outcome: Result.Result<Option.Option<string>, string>
) {
	const next = $.evolve({executing: false})
	const dialog = Option.getOrUndefined($.model.dialog)
	if (Operation.isAnyOf(['Logs'])(operation)) {
		if (dialog === undefined || !Dialog.isAnyOf(['Logs'])(dialog) || dialog.id !== operation.id) return next
		return next.evolve({
			dialog: Option.some({
				...dialog,
				result: Result.match(outcome, {
					onFailure: error => Option.some(Result.fail(error)),
					onSuccess: Option.map(Result.succeed)
				})
			})
		})
	}
	return Result.match(outcome, {
		onFailure: error => next.evolve({dialog: Option.some(Dialog.cases.Failure.make({text: error}))}),
		onSuccess: () => next.evolve({dialog: Option.none()})
	})
}

function historyStatus(model: Model, snapshot: Snapshot) {
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	if (Option.isSome(blockingFailure(model.metrics)) || Option.isSome(blockingFailure(model.appHistory))) {
		return {retry: true, text: 'Couldn’t load history'}
	}
	if (AsyncResult.isFailure(model.metrics) || AsyncResult.isFailure(model.appHistory) || history?.stale === true) {
		return {retry: true, text: 'History may be out of date'}
	}
	const problems = [
		...Array.flatMap(snapshot.sources, source =>
			Option.toArray(Option.map(source.error, reason => `${source.name}: ${reason}`))
		),
		...Option.toArray(history?.error ?? Option.none())
	]
	if (Array.isArrayNonEmpty(problems)) return {retry: false, text: Array.join(problems, ' · ')}
	if (history !== undefined && Array.isReadonlyArrayEmpty(history.samples)) {
		return {retry: false, text: 'No history in the last hour'}
	}
	return undefined
}

function problemOf(model: Model) {
	const reads: readonly Read[] = [model.inventory, model.metrics, model.appHistory]
	if (Array.some(reads, signInRequested)) {
		return {signIn: true, text: Option.getOrElse(model.authError, Function.constant('Sign in to Deploy'))}
	}
	if (Array.some(reads, read => AsyncResult.isFailure(read) && isDeniedCause(read.cause))) {
		return {text: 'Access denied'}
	}
	if (DeployRoute.isAnyOf(['NotFound'])(model.route)) return {back: true, text: 'App not found'}
	return undefined
}

function exposureInput(model: Model, dialog: typeof Dialog.cases.Expose.Type) {
	const snapshot = AsyncResult.value(model.inventory)
	const publicAccess = dialog.kind === 'public'
	const hostname = Boolean.match(publicAccess, {
		onFalse: () => pipe(snapshot, Option.flatMap(machineHost), Option.getOrElse(Function.constant(''))),
		onTrue: () => pipe(dialog.hostname, String.trim, String.toLowerCase)
	})
	return {
		hostname,
		kind: dialog.kind,
		name: ExposureName.make(publicAccess ? `public:${hostname}` : `tailnet:${shown(dialog.port.port, String.String)}`),
		port: Option.getOrElse(dialog.port.port, Function.constant(0)),
		publicAccess
	}
}

function dialogOf(model: Model) {
	return Option.getOrUndefined(
		Option.map(model.dialog, dialog => {
			const pending = model.executing && Dialog.isAnyOf(['Expose'])(dialog)
			const toolbar: readonly ToolbarAction[] = [
				...(Dialog.isAnyOf(['Expose'])(dialog)
					? [
							{
								disabled: pending,
								id: 'reach',
								label: 'Who can reach the port',
								symbol: 'chevron.down' as const,
								menu: Array.map(ExposeInput.fields.kind.literals, kind => ({
									checked: dialog.kind === kind,
									id: kind,
									label: String.capitalize(kind)
								}))
							}
						]
					: []),
				{disabled: pending, id: 'close', label: 'Close', symbol: 'xmark'}
			]
			return Dialog.match(dialog, {
				Expose: expose => {
					const input = exposureInput(model, expose)
					return {
						...expose,
						disabled: pending || !Schema.is(ExposeInput)(input),
						hostname: expose.hostname,
						label: `Expose ${Option.getOrElse(expose.port.process, () => expose.port.name)}`,
						pending,
						subtitle: `Port ${input.port} · ${String.capitalize(expose.kind)}`,
						text: input.hostname === '' ? 'No tailnet address' : `https://${input.hostname}:${input.port}`,
						toolbar
					}
				},
				Failure: failure => ({...failure, label: 'Couldn’t complete the action', pending, toolbar}),
				Logs: logs => ({
					...logs,
					label: `${logs.name} logs`,
					pending,
					text: Option.match(logs.result, {
						onNone: Function.constant('Loading logs…'),
						onSome: result =>
							Result.match(result, {
								onFailure: Function.identity,
								onSuccess: text => (String.isNonEmpty(String.trim(text)) ? text : 'No logs')
							})
					}),
					toolbar
				})
			})
		})
	)
}

function toolbar(item: InventoryItem | undefined, admin: boolean, pending: boolean): readonly ToolbarAction[] {
	if (!admin || item === undefined) return []
	if (Option.contains(item.scheduled, true)) {
		return [{disabled: pending || item.running, id: 'run', label: 'Run now', symbol: 'play.fill'}]
	}
	if (Option.isNone(ownerOf(item))) return []
	return [
		{disabled: pending, id: 'restart', label: 'Restart', symbol: 'arrow.clockwise'},
		{disabled: pending, id: 'logs', label: 'Logs', symbol: 'doc.text'},
		{disabled: pending || !(item.active || item.running), id: 'stop', label: 'Stop', symbol: 'stop.fill'}
	]
}

function actionOf(item: InventoryItem | undefined, action: string | undefined) {
	if (action === 'close') return Message.ClosedDialog()
	if (action === 'tailnet' || action === 'public') return Message.ExposureKind({kind: action})
	if (item === undefined) return undefined
	if (action === 'run') return Message.Operation({operation: runJob(item)})
	const id = ownerOf(item)
	if (Option.isNone(id)) return undefined
	if (action === 'logs') return Message.OpenedLogs({id: id.value, name: workloadName(item)})
	if (action === 'restart') return Message.Operation({operation: Operation.cases.Restart.make({id: id.value})})
	if (action === 'stop') return Message.Operation({operation: Operation.cases.Stop.make({id: id.value})})
	return undefined
}

function screenOf(model: Model) {
	const snapshot = Option.getOrUndefined(AsyncResult.value(model.inventory))
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	const app = Option.getOrUndefined(AsyncResult.value(model.appHistory))
	const rows = rowsOf(model.inventory)
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const explicitId = appOf(model.route)
	const id = explicitId ?? Option.getOrUndefined(model.defaultApp)
	const row = Option.getOrUndefined(Array.findFirst(rows, candidate => candidate.item.id === id))
	const machine = snapshot === undefined ? undefined : machineDetail(snapshot, history)
	const loading = AsyncResult.isInitial(model.inventory)
	const historyLoading = AsyncResult.isInitial(model.metrics)
	const appLoading = Option.isSome(model.effectiveApp) && AsyncResult.isInitial(model.appHistory)
	const restart = restartReason(app?.restarts ?? [], model.now)
	const list = Array.map(rows, entry =>
		listItem(entry, model.now, entry.item.id === row?.item.id ? restart : undefined, history, latest)
	)
	const detail = row === undefined ? undefined : appDetail(row, rows, model.now, history, app)
	const inventoryFailed = Option.isSome(blockingFailure(model.inventory))
	return {
		admin: model.admin,
		actions: toolbar(row?.item, model.admin, model.executing),
		detail,
		dialog: dialogOf(model),
		historyLoading: historyLoading || appLoading,
		historyStatus: snapshot === undefined ? undefined : historyStatus(model, snapshot),
		id,
		inventoryFailed,
		list,
		listStatus: inventoryFailed
			? 'Couldn’t load apps'
			: AsyncResult.isFailure(model.inventory)
				? 'Apps may be out of date'
				: undefined,
		load: loadAverages(history),
		loading,
		machine,
		machineSelected: id === MACHINE,
		missing: explicitId !== undefined && row === undefined,
		now: model.now,
		pending: model.executing,
		problem: problemOf(model),
		row
	}
}

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Deploy',
	props: Schema.Struct({autoSignIn: Schema.Boolean, route: DeployRoute}),
	restore: model => ({...model, dialog: Option.none(), executing: false})
}).make({
	init: $ => ({
		admin: false,
		appHistory: AsyncResult.initial(),
		authError: Option.none(),
		defaultApp: Option.none(),
		dialog: Option.none(),
		effectiveApp: Option.none(),
		executing: false,
		hasListBehind: false,
		inventory: AsyncResult.initial(),
		metrics: AsyncResult.initial(),
		now: DateTime.nowUnsafe(),
		redirected: false,
		route: $.props.route
	}),
	subscriptions: $ => [
		Router.subscription(DeployRoute, $.model.route, route => Message.Route({route})),
		DeployRoute.isAnyOf(['Home'])($.model.route) &&
			Subscription.make(
				'inventory',
				readDeploy(
					reads => reads.inventory,
					result => Message.Inventory({result})
				)
			),
		DeployRoute.isAnyOf(['Home'])($.model.route) &&
			Subscription.make(
				'metrics',
				readDeploy(
					reads => reads.metrics,
					result => Message.Metrics({result})
				)
			),
		DeployRoute.isAnyOf(['Home'])($.model.route) &&
			Subscription.make(
				'account',
				readDeploy(
					reads => reads.account,
					result => Message.Account({admin: Option.exists(AsyncResult.value(result), account => account.admin)})
				)
			),
		Subscription.make(
			'clock',
			observe(clockAtom('1 second'), now => Message.Clock({now}))
		),
		Option.getOrUndefined(
			Option.map($.model.effectiveApp, id =>
				Subscription.make('app', id, app =>
					readDeploy(
						reads => reads.app(app),
						result => Message.AppHistory({id: app, result})
					)
				)
			)
		)
	],
	update: {
		Account: ($, message) => $.evolve({admin: message.admin}),
		AppHistory: ($, message) => {
			if (!Option.contains($.model.effectiveApp, message.id)) return $.model
			return completeRead($.evolve({appHistory: message.result}), message.result, $.props.autoSignIn)
		},
		Back: $ => {
			if (!DeployRoute.isAnyOf(['Home'])($.model.route)) {
				return $.run(Command.asNoop(Router.replace(DeployRoute, DeployRoute.Home({search: {}}))))
			}
			if ($.model.hasListBehind) return $.run(Command.asNoop(Router.Back.make({})))
			return $.run(Command.asNoop(Router.patchSearch(DeployRoute, $.model.route, {pane: 'apps'})))
		},
		Clock: ($, message) => $.evolve({now: message.now}),
		ClosedDialog: $ => {
			const dialog = Option.getOrUndefined($.model.dialog)
			if (dialog === undefined || ($.model.executing && Dialog.isAnyOf(['Expose'])(dialog))) return $.model
			return $.evolve({dialog: Option.none()})
		},
		Expose: $ => {
			const dialog = Option.getOrUndefined($.model.dialog)
			if (!$.model.admin || $.model.executing || dialog === undefined || !Dialog.isAnyOf(['Expose'])(dialog))
				return $.model
			const input = exposureInput($.model, dialog)
			if (!Schema.is(ExposeInput)(input)) return $.model
			return $.evolve({executing: true}).run(execute(Operation.cases.Expose.make({input})))
		},
		ExposureKind: ($, message) =>
			$.evolve({
				dialog: Option.map($.model.dialog, dialog =>
					Dialog.isAnyOf(['Expose'])(dialog) ? {...dialog, kind: message.kind} : dialog
				)
			}),
		Hostname: ($, message) =>
			$.evolve({
				dialog: Option.map($.model.dialog, dialog =>
					Dialog.isAnyOf(['Expose'])(dialog) ? {...dialog, hostname: message.value} : dialog
				)
			}),
		Inventory: ($, message) =>
			completeRead($.set(moveTo(message.result, $.model.route, $.model)), message.result, $.props.autoSignIn),
		Metrics: ($, message) => completeRead($.evolve({metrics: message.result}), message.result, $.props.autoSignIn),
		OpenedExposure: ($, message) => {
			if (!$.model.admin || $.model.executing) return $.model
			return $.evolve({
				dialog: Option.some(Dialog.cases.Expose.make({hostname: '', kind: 'tailnet', port: message.port}))
			})
		},
		OpenedLogs: ($, message) => {
			if (!$.model.admin || $.model.executing) return $.model
			return $.evolve({
				dialog: Option.some(Dialog.cases.Logs.make({id: message.id, name: message.name, result: Option.none()})),
				executing: true
			}).run(execute(Operation.cases.Logs.make({id: message.id})))
		},
		OpenedUrl: ($, message) => $.run(Command.asNoop(OpenEndpoint.make({url: message.url}))),
		Operation: ($, message) => {
			if (!$.model.admin || $.model.executing) return $.model
			return $.evolve({executing: true}).run(execute(message.operation))
		},
		OperationDone: ($, message) => settleOperation($, message.operation, Result.succeed(message.text)),
		OperationFailed: ($, message) => settleOperation($, message.operation, Result.fail(message.error)),
		Retry: $ => $.run(Command.asNoop(Refresh.make({authenticated: false, id: $.model.effectiveApp}))),
		Route: ($, message) => {
			const opened = isDetail(message.route)
			const wasOpened = isDetail($.model.route)
			const next = $.set({
				...moveTo($.model.inventory, message.route, $.model),
				dialog: Option.none(),
				hasListBehind: opened && $.model.hasListBehind
			})
			if (opened && !wasOpened) return next.viewTransition(['design-detail-in'])
			if (!opened && wasOpened) return next.viewTransition(['design-detail-out'])
			return next
		},
		Select: ($, message) => {
			if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
			const opened = isDetail($.model.route)
			return $.evolve({hasListBehind: $.model.hasListBehind || !opened}).run(
				Command.asNoop(
					Router.patchSearch(
						DeployRoute,
						$.model.route,
						{app: message.id, pane: 'process'},
						{history: opened ? 'replace' : 'push'}
					)
				)
			)
		},
		SignIn: $ => $.evolve({authError: Option.none()}).run(authenticate()),
		SignInFailed: ($, message) => $.evolve({authError: Option.some(message.text)}),
		SignedIn: ($, message) => {
			if (!message.signedIn) return $.model
			return $.run(Command.asNoop(Refresh.make({authenticated: true, id: $.model.effectiveApp})))
		}
	},
	parts: (p, model) => {
		const screen = screenOf(model)
		return {
			...screen,
			authenticate: p.part((el, event: string) => el.on(event, Message.SignIn())),
			choose: p.part((el, event: string, id: (payload: unknown) => string | undefined) =>
				el.on(event, value => actionOf(screen.row?.item, id(value)))
			),
			dismiss: p.part((el, event: string) => el.on(event, Message.ClosedDialog())),
			expose: p.part((el, event: string, port: InventoryItem) => el.on(event, Message.OpenedExposure({port}))),
			hostname: p.part((el, event: string) =>
				el.on(event, value => {
					if (Predicate.hasProperty(value, 'value') && Predicate.isString(value.value))
						return Message.Hostname({value: value.value})
					return undefined
				})
			),
			openUrl: p.part((el, event: string, url: string) => el.on(event, Message.OpenedUrl({url}))),
			retry: p.part((el, event: string) => el.on(event, Message.Retry())),
			run: p.part((el, event: string, item: InventoryItem) =>
				el.on(event, Message.Operation({operation: runJob(item)}))
			),
			selection: {
				back: p.part((el, event: string) => el.on(event, Message.Back())),
				id: isDetail(model.route) ? appOf(model.route) : undefined,
				select: p.part((el, event: string, id: string) => el.on(event, Message.Select({id: ItemId.make(id)})))
			},
			signingIn: p.isRunning(Authenticate),
			submit: p.part((el, event: string) =>
				el.on(event, Message.Expose(), event === 'submit' ? {preventDefault: 'always'} : undefined)
			)
		}
	}
})

export type DeployScreen = Component.Headless.Parts<typeof Screen>

export function DeployView<M, R>(
	h: View.HelperBase<M, unknown>,
	props: {readonly autoSignIn: boolean; readonly route: DeployRoute},
	view: (screen: DeployScreen) => View.Content<M, R>
) {
	return Screen(h, {props, view})
}
