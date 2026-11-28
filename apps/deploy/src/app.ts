import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'

import {Array, Boolean, Function, Option, Predicate, Result, Schema, pipe} from 'effect'
import type {DateTime} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction, ToolbarOptions} from '@deslop/components/model'
import {
	OpenUrl,
	goBack,
	listBehind,
	openItem,
	readState,
	selection,
	shellApp,
	slide
} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {DeployRoute, Execute, Operation, appOf, isDetail, readDeploy} from './reads.ts'

import {ExposeInput} from '#exposures/contract.ts'
import {exposeSheet, exposureInput, exposuresDialogs, exposuresMessages, reachAction} from '#exposures/screen.ts'
import {ItemId} from '#inventory/contract.ts'
import type {InventoryItem} from '#inventory/contract.ts'
import {
	actionsOf,
	appDetail,
	failureSheet,
	inventoryDialogs,
	inventoryFields,
	inventoryMessages,
	listItem,
	logsSheet,
	moveTo,
	ownerOf,
	rowsOf,
	runJob
} from '#inventory/screen.ts'
import {workloadName} from '#inventory/shared.ts'
import {MACHINE, loadAverages, machineDetail} from '#machine/screen.ts'
import {historyStatus, metricsFields, metricsMessages, restartReason} from '#metrics/screen.ts'

const LIST_STATUS = {failed: 'Couldn’t load apps', stale: 'Apps may be out of date'} as const

// The screen's model and messages: each feature's part, and the route's. The shell owns the session, the clock and the retry.
type Dialog = typeof Dialog.Type
const Dialog = Schema.TaggedUnion({...exposuresDialogs, ...inventoryDialogs})

type Model = typeof Model.Type
const Model = Schema.Struct({
	...inventoryFields,
	...metricsFields,
	admin: Schema.Boolean,
	dialog: Schema.Option(Dialog),
	executing: Schema.Boolean,
	hasListBehind: Schema.Boolean,
	route: DeployRoute
})

const Message = UiSchema.TaggedEnum({
	...exposuresMessages,
	...inventoryMessages,
	...metricsMessages,
	Account: {admin: Schema.Boolean},
	Back: {},
	ClosedDialog: {},
	Operation: {operation: Operation},
	OperationDone: {operation: Operation, text: Schema.Option(Schema.String)},
	OperationFailed: {error: Schema.String, operation: Operation},
	Route: {route: DeployRoute}
})

type Message = typeof Message.Type

function dialogOf(model: Model) {
	return Option.getOrUndefined(
		Option.map(model.dialog, dialog => {
			const pending = model.executing && Dialog.isAnyOf(['Expose'])(dialog)
			const actions: readonly ToolbarAction[] = [
				...pipe(
					dialog,
					Option.liftPredicate(Dialog.isAnyOf(['Expose'])),
					Option.map(expose => reachAction(expose, pending)),
					Option.toArray
				),
				{disabled: pending, id: 'close', label: 'Close', symbol: 'xmark'}
			]
			return Dialog.match(dialog, {
				Expose: expose => exposeSheet(model.inventory, expose, pending, actions),
				Failure: failure => failureSheet(failure, pending, actions),
				Logs: logs => logsSheet(logs, pending, actions)
			})
		})
	)
}

function actionOf(action?: string, item?: InventoryItem) {
	if (action === 'close') return Message.ClosedDialog()
	if (action === 'tailnet' || action === 'public') return Message.ExposureKind({kind: action})
	if (item === undefined) return undefined
	if (action === 'run') return Message.Operation({operation: runJob(item)})
	return Option.match(ownerOf(item), {
		onNone: Function.constUndefined,
		onSome: id => {
			if (action === 'logs') return Message.OpenedLogs({id, name: workloadName(item)})
			if (action === 'restart') return Message.Operation({operation: Operation.cases.Restart.make({id})})
			if (action === 'stop') return Message.Operation({operation: Operation.cases.Stop.make({id})})
			return undefined
		}
	})
}

function screenOf(model: Model, now: DateTime.Utc) {
	const snapshot = Option.getOrUndefined(AsyncResult.value(model.inventory))
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	const app = Option.getOrUndefined(AsyncResult.value(model.appHistory))
	const rows = rowsOf(model.inventory)
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const explicitId = appOf(model.route)
	const id = explicitId ?? Option.getOrUndefined(model.defaultApp)
	const row = Option.getOrUndefined(Array.findFirst(rows, candidate => candidate.item.id === id))
	const machine = Option.getOrUndefined(
		Option.map(Option.fromUndefinedOr(snapshot), value => machineDetail(value, history))
	)
	const loading = AsyncResult.isInitial(model.inventory)
	const historyLoading = AsyncResult.isInitial(model.metrics)
	const appLoading = Option.isSome(model.effectiveApp) && AsyncResult.isInitial(model.appHistory)
	const restart = restartReason(app?.restarts ?? [], now)
	const list = Array.map(rows, entry =>
		listItem(
			entry,
			now,
			Boolean.match(entry.item.id === row?.item.id, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant(restart)
			}),
			history,
			latest
		)
	)
	const detail = Option.getOrUndefined(
		Option.map(Option.fromUndefinedOr(row), value => appDetail(value, rows, now, history, app))
	)
	const inventoryState = readState([model.inventory])
	return {
		actions: actionsOf(model.admin, model.executing, row?.item),
		admin: model.admin,
		detail,
		dialog: dialogOf(model),
		historyLoading: historyLoading || appLoading,
		historyStatus: pipe(
			snapshot,
			Option.fromUndefinedOr,
			Option.flatMap(value => Option.fromUndefinedOr(historyStatus(model, value))),
			Option.getOrUndefined
		),
		id,
		inventoryFailed: Option.contains(inventoryState, 'failed'),
		list,
		listStatus: Option.getOrUndefined(Option.map(inventoryState, state => LIST_STATUS[state])),
		load: loadAverages(history),
		loading,
		machine,
		machineSelected: id === MACHINE,
		missing: explicitId !== undefined && row === undefined,
		now,
		pending: model.executing,
		reads: [model.inventory, model.metrics, model.appHistory],
		routeMissing: DeployRoute.isAnyOf(['NotFound'])(model.route),
		row
	}
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

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Deploy',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: DeployRoute}),
	restore: model => ({...model, dialog: Option.none(), executing: false})
}).make({
	init: $ => ({
		admin: false,
		appHistory: AsyncResult.initial(),
		defaultApp: Option.none(),
		dialog: Option.none(),
		effectiveApp: Option.none(),
		executing: false,
		hasListBehind: false,
		inventory: AsyncResult.initial(),
		metrics: AsyncResult.initial(),
		route: $.props.route
	}),
	parts: (p, model) => {
		const screen = screenOf(model, p.props.now)
		return {
			...screen,
			choose: p.part((el, event: string, id: Parameters<ToolbarOptions['choose']>[2]) =>
				el.on(event, value => actionOf(id(value), screen.row?.item))
			),
			dismiss: p.part((el, event: string) => el.on(event, Message.ClosedDialog())),
			expose: p.part((el, event: string, port: InventoryItem) => el.on(event, Message.OpenedExposure({port}))),
			hostname: p.part((el, event: string) =>
				el.on(event, value => {
					if (Predicate.hasProperty(value, 'value') && Predicate.isString(value.value)) {
						return Message.Hostname({value: value.value})
					}
					return undefined
				})
			),
			openUrl: p.part((el, event: string, url: string) => el.on(event, Message.OpenedUrl({url}))),
			run: p.part((el, event: string, item: InventoryItem) =>
				el.on(event, Message.Operation({operation: runJob(item)}))
			),
			selection: selection(p, {
				back: Message.Back(),
				id: appOf(model.route),
				open: isDetail(model.route),
				select: id => Message.Select({id: ItemId.make(id)})
			}),
			submit: p.part((el, event: string) =>
				el.on(
					event,
					Message.Expose(),
					Boolean.match(event === 'submit', {
						onFalse: Function.constUndefined,
						onTrue: () => ({preventDefault: 'always' as const})
					})
				)
			)
		}
	},
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
			return $.evolve({appHistory: message.result})
		},
		Back: $ => $.run(goBack($.model, DeployRoute.Home({search: {}}), {pane: 'apps'})),
		ClosedDialog: $ => {
			const dialog = Option.getOrUndefined($.model.dialog)
			if (dialog === undefined || ($.model.executing && Dialog.isAnyOf(['Expose'])(dialog))) return $.model
			return $.evolve({dialog: Option.none()})
		},
		Expose: $ => {
			const dialog = Option.getOrUndefined($.model.dialog)
			if (!$.model.admin || $.model.executing || dialog === undefined || !Dialog.isAnyOf(['Expose'])(dialog)) {
				return $.model
			}
			const input = exposureInput($.model.inventory, dialog)
			if (!Schema.is(ExposeInput)(input)) return $.model
			return $.evolve({executing: true}).run(execute(Operation.cases.Expose.make({input})))
		},
		ExposureKind: ($, message) =>
			$.evolve({
				dialog: Option.map($.model.dialog, dialog => {
					if (Dialog.isAnyOf(['Expose'])(dialog)) return {...dialog, kind: message.kind}
					return dialog
				})
			}),
		Hostname: ($, message) =>
			$.evolve({
				dialog: Option.map($.model.dialog, dialog => {
					if (Dialog.isAnyOf(['Expose'])(dialog)) return {...dialog, hostname: message.value}
					return dialog
				})
			}),
		Inventory: ($, message) => $.set({...$.model, ...moveTo(message.result, $.model.route, $.model)}),
		Metrics: ($, message) => $.evolve({metrics: message.result}),
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
		OpenedUrl: ($, message) => $.run(Command.asNoop(OpenUrl.make({url: message.url}))),
		Operation: ($, message) => {
			if (!$.model.admin || $.model.executing) return $.model
			return $.evolve({executing: true}).run(execute(message.operation))
		},
		OperationDone: ($, message) => settleOperation($, message.operation, Result.succeed(message.text)),
		OperationFailed: ($, message) => settleOperation($, message.operation, Result.fail(message.error)),
		Route: ($, message) =>
			slide(
				$.set({
					...$.model,
					...moveTo($.model.inventory, message.route, $.model),
					dialog: Option.none(),
					hasListBehind: isDetail(message.route) && $.model.hasListBehind,
					route: message.route
				}),
				isDetail,
				$.model.route,
				message.route
			),
		Select: ($, message) => {
			if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
			return $.evolve({hasListBehind: listBehind($.model, isDetail)}).run(
				openItem($.model.route, isDetail, {app: message.id, pane: 'process'})
			)
		}
	}
})

export type DeployScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const DeployApp = shellApp({
	every: '1 second',
	missing: 'App not found',
	name: 'Deploy',
	props: Schema.Struct({route: DeployRoute}),
	screen: Screen
})
