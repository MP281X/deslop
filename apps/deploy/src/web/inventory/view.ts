import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Equal, Function, Layer, Option, Result, Schema, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'
import {accountAtom} from '@deslop/runtime/web/client'
import {ActionShell} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Notice} from '@deslop/ui/axis'
import {PressFeedback} from '@deslop/ui/control'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import type {Pane} from '@deslop/ui/split'
import {observe} from '@deslop/ui/state'

import {availablePorts, itemOwner, workloads} from '#contracts'
import type {MachineHistory, Row, Snapshot} from '#contracts'

import {AppActions} from '#web/inventory/actions.ts'
import {ReadState} from '#web/inventory/axis.ts'
import {Operation, appHistoryAtom, inventoryAtom, metricsAtom} from '#web/inventory/client.ts'
import {Detail, MachineDetail} from '#web/inventory/detail.ts'
import {Dialog} from '#web/inventory/dialog.ts'
import type {Focused} from '#web/inventory/list.ts'
import {List} from '#web/inventory/list.ts'
import {LoadingApps, LoadingReadings} from '#web/inventory/loading.ts'
import {DialogState, Execute, MACHINE, Message, Model, Refresh, SignIn, signInRequested} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {rowOrder, statusLine} from '#web/inventory/rows.ts'
import {RestartReason} from '#web/inventory/traces.ts'
import {hasListBehind, usedHistoryMotion} from '#web/inventory/viewport.ts'
import {DeployRoute} from '#web/routes.ts'

function selected(rows: readonly Row[], route: Model['route'], defaultApp: Model['defaultApp']) {
	if (!DeployRoute.isAnyOf(['Home'])(route)) return Option.none()
	return pipe(
		Option.fromUndefinedOr(route.search.app),
		Option.orElse(() => defaultApp),
		Option.flatMap(id => Array.findFirst(rows, row => row.item.id === id))
	)
}

function moveTo(inventory: Model['inventory'], route: Model['route'], current: Model) {
	const rows = pipe(
		AsyncResult.value(inventory),
		Option.map(snapshot => Array.sort(workloads(snapshot.items), rowOrder)),
		Option.getOrElse(Array.empty<Row>)
	)
	const defaultApp = Option.orElse(current.defaultApp, () =>
		pipe(
			rows,
			Array.findFirst(row => !Option.contains(row.item.scheduled, true)),
			Option.map(row => row.item.id)
		)
	)
	const effectiveApp = pipe(
		selected(rows, route, defaultApp),
		Option.map(row => row.item),
		Option.filter(item => item.kind === 'service' && Option.contains(item.owned, true)),
		Option.map(itemOwner)
	)
	return {
		...current,
		appHistory: pipe(current.effectiveApp, Equal.equals(effectiveApp), Boolean.match({
			onFalse: () => AsyncResult.initial(),
			onTrue: () => current.appHistory
		})),
		defaultApp,
		effectiveApp,
		inventory,
		route
	}
}

function showOf(route: Model['route']): Pane {
	if (!DeployRoute.isAnyOf(['Home'])(route)) return 'list'
	if (route.search.pane === 'apps' || route.search.app === undefined) return 'list'
	return 'detail'
}

function appOf(route: Model['route']) {
	if (DeployRoute.isAnyOf(['Home'])(route)) return route.search.app
	return undefined
}

function sidebar(model: Model): ShellAction<Message> {
	if (model.narrow && showOf(model.route) === 'detail') {
		return {id: 'sidebar', message: Message.Sidebar(), symbol: 'chevron.left', title: 'Back'}
	}
	return {
		disabled: model.narrow && appOf(model.route) === undefined && Option.isNone(model.defaultApp),
		id: 'sidebar',
		message: Message.Sidebar(),
		pressed: model.narrow || !model.listHidden,
		symbol: 'sidebar.left',
		title: 'Sidebar'
	}
}

function historyStatus(h: H, model: Model, snapshot: Snapshot) {
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	if (Option.isSome(blockingFailure(model.metrics)) || Option.isSome(blockingFailure(model.appHistory))) {
		return Notice(h, 'Couldn’t load history', Message.Retry())
	}
	if (AsyncResult.isFailure(model.metrics) || AsyncResult.isFailure(model.appHistory) || history?.stale === true) {
		return Notice(h, 'History may be out of date', Message.Retry())
	}
	const problems = [
		...Array.flatMap(snapshot.sources, source =>
			Option.toArray(Option.map(source.error, reason => `${source.name}: ${reason}`))
		),
		...Option.toArray(history?.error ?? Option.none())
	]
	if (Array.isArrayNonEmpty(problems)) return Notice(h, Array.join(problems, ' · '))
	if (history !== undefined && Array.isReadonlyArrayEmpty(history.samples))
		{return Notice(h, 'No history in the last hour')}
	return undefined
}

function details(
	h: H,
	model: Model,
	snapshot: Snapshot,
	rows: readonly Row[],
	row: Row | undefined,
	metrics: MachineHistory | undefined,
	focused: Focused | undefined,
	pending: boolean
) {
	const id = appOf(model.route)
	const loadingHistory = AsyncResult.isInitial(model.metrics)
	const status = historyStatus(h, model, snapshot)
	if (id === MACHINE) return MachineDetail(h, model.now, snapshot, status, loadingHistory, metrics)
	if (row === undefined) {
		if (id !== undefined) return Notice(h, 'App not found')
		return undefined
	}
	return Detail(h, {
		admin: model.admin,
		app: Option.getOrUndefined(AsyncResult.value(model.appHistory)),
		free: availablePorts(rows),
		history: metrics,
		line: focused?.line,
		loading: loadingHistory || (Option.isSome(model.effectiveApp) && AsyncResult.isInitial(model.appHistory)),
		now: model.now,
		pending,
		restart: focused?.restart,
		row,
		rows,
		status
	})
}

function Workspace(h: H, model: Model) {
	const main = h.main.class('deploy axis-controls').onMount(PressFeedback({}))
	const route = model.route
	if (!DeployRoute.isAnyOf(['Home'])(route)) {
		return main.children(h.a.attr('href', '/').children('Back to Deploy'))
	}
	const reads: readonly AsyncResult.AsyncResult<unknown, unknown>[] = [model.inventory, model.metrics, model.appHistory]
	if (Array.some(reads, result => AsyncResult.isFailure(result) && isDeniedCause(result.cause))) {
		if (Array.some(reads, signInRequested)) return main.children(Notice(h, 'Signing in…'))
		return main.children(Notice(h, 'Access denied'))
	}
	const show = showOf(route)
	const snapshot = AsyncResult.value(model.inventory)
	const rows = pipe(
		snapshot,
		Option.map(value => Array.sort(workloads(value.items), rowOrder)),
		Option.getOrElse(Array.empty<Row>)
	)
	const selection = selected(rows, route, model.defaultApp)
	const row = Option.getOrUndefined(selection)
	const focusId = route.search.app ?? row?.item.id
	const pending = h.isRunning(Execute)
	const collapsed = !model.narrow && model.listHidden
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	const restarts = pipe(
		AsyncResult.value(model.appHistory),
		Option.map(app => app.restarts),
		Option.getOrElse(Array.empty<DateTime.Utc>)
	)
	const restart = RestartReason(restarts, model.now)
	const focused = Option.getOrUndefined(
		Option.map(selection, row => ({id: row.item.id, line: statusLine(row, model.now, restart), restart, restarts}))
	)
	const retry = Message.Retry()
	const unavailable = 'Couldn’t load apps'
	return main.children(
		ActionShell(h, {
			actions: pipe(
				selection,
				Option.filter(() => model.admin && (!model.narrow || show === 'detail')),
				Option.map(row => AppActions(row.item, pending)),
				Option.getOrElse(Array.empty<ShellAction<Message>>)
			),
			content: Split(h, {
				detail: {
					content: ReadState(h, model.inventory, {
						content: value => details(h, model, value, rows, row, history, focused, pending),
						loading: h.div.class('deploy-startup-detail').children(LoadingReadings(h)),
						retry,
						unavailable
					}),
					key: focusId ?? 'detail',
					label: 'App detail'
				},
				list: {
					content: ReadState(h, model.inventory, {
						content: (value, stale) =>
							List(h, {
								admin: model.admin,
								focused,
								history,
								loading: AsyncResult.isInitial(model.metrics),
								now: model.now,
								pending,
								rows,
								selected: Option.filter(Option.fromUndefinedOr(focusId), () => !model.narrow && !collapsed),
								snapshot: value,
								stale
							}),
						loading: LoadingApps(h),
						retry,
						unavailable
					}),
					label: 'Apps'
				},
				listHidden: collapsed,
				narrow: model.narrow,
				show
			}),
			overlays: Option.getOrUndefined(
				Option.map(model.dialog, dialog => Dialog(h, dialog, Option.getOrUndefined(snapshot), pending))
			),
			sidebar: sidebar(model)
		})
	)
}

function completeRead(next: Component.Step<Model, Message, never>, result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (signInRequested(result)) return next.run(Command.asNoop(SignIn.make({})))
	return next
}

const DeployDef = Html.component({
	message: Message,
	model: Model,
	name: 'Deploy',
	props: Schema.Struct({route: DeployRoute})
})

export const Deploy = pipe(
	DeployDef.make({
		init: $ => ({
			admin: false,
			appHistory: AsyncResult.initial(),
			defaultApp: Option.none(),
			dialog: Option.none(),
			effectiveApp: Option.none(),
			executing: false,
			inventory: AsyncResult.initial(),
			listHidden: false,
			metrics: AsyncResult.initial(),
			narrow: singlePane(),
			now: DateTime.nowUnsafe(),
			route: $.props.route
		}),
		subscriptions: $ => [
			Router.subscription(DeployRoute, $.model.route, route => Message.Route({route})),
			...watchPanes(() => Message.Posture({narrow: singlePane()})),
			DeployRoute.isAnyOf(['Home'])($.model.route) &&
				Subscription.make(
					'inventory',
					observe(inventoryAtom, result => Message.Inventory({result}))
				),
			DeployRoute.isAnyOf(['Home'])($.model.route) &&
				Subscription.make(
					'metrics',
					observe(metricsAtom, result => Message.Metrics({result}))
				),
			DeployRoute.isAnyOf(['Home'])($.model.route) &&
				Subscription.make(
					'account',
					observe(accountAtom, result =>
						Message.Account({admin: Option.exists(AsyncResult.value(result), account => account.admin)})
					)
				),
			Subscription.make(
				'clock',
				observe(clockAtom('1 second'), now => Message.Clock({now}))
			),
			Option.getOrUndefined(
				Option.map($.model.effectiveApp, id =>
					Subscription.make('app', id, app =>
						observe(appHistoryAtom(app), result => Message.AppHistory({id: app, result}))
					)
				)
			)
		],
		update: {
			Account: ($, message) => $.evolve({admin: message.admin}),
			AppHistory: ($, message) => {
				if (!Option.contains($.model.effectiveApp, message.id)) return $.model
				return completeRead($.evolve({appHistory: message.result}), message.result)
			},
			Clock: ($, message) => $.evolve({now: message.now}),
			ClosedDialog: $ => {
				const dialog = Option.getOrUndefined($.model.dialog)
				if (dialog === undefined || ($.model.executing && dialog._tag === 'Expose')) return $.model
				return $.evolve({dialog: Option.none()}).viewTransition(['axis-sheet-close'])
			},
			ExposureKind: ($, {kind}) =>
				$.evolve({
					dialog: Option.map($.model.dialog, dialog => {
						if (dialog._tag === 'Expose') return {...dialog, choosing: false, kind}
						return dialog
					})
				}),
			ExposureMenu: ($, {open}) =>
				$.evolve({
					dialog: Option.map($.model.dialog, dialog => {
						if (dialog._tag === 'Expose') return {...dialog, choosing: open}
						return dialog
					})
				}),
			Inventory: ($, {result}) => completeRead($.set(moveTo(result, $.model.route, $.model)), result),
			Metrics: ($, {result}) => completeRead($.evolve({metrics: result}), result),
			OpenedExposure: ($, {port}) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({
					dialog: Option.some(DialogState.cases.Expose.make({choosing: false, kind: 'tailnet', port}))
				}).viewTransition(['axis-sheet-open'])
			},
			OpenedLogs: ($, {id, name}) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({
					dialog: Option.some(DialogState.cases.Logs.make({id, name, result: Option.none()})),
					executing: true
				})
					.viewTransition(['axis-sheet-open'])
					.run(Execute.make({operation: Operation.cases.Logs.make({id})}))
			},
			Operation: ($, message) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({executing: true}).run(Execute.make({operation: message.operation}))
			},
			OperationDone: ($, message) => {
				const next = $.evolve({executing: false})
				const dialog = Option.getOrUndefined($.model.dialog)
				if (message.operation._tag === 'Logs') {
					if (dialog?._tag !== 'Logs' || dialog.id !== message.operation.id) return next
					return next.evolve({dialog: Option.some({...dialog, result: Option.map(message.text, Result.succeed)})})
				}
				if (dialog === undefined) return next
				return next.evolve({dialog: Option.none()}).viewTransition(['axis-sheet-close'])
			},
			OperationFailed: ($, message) => {
				const next = $.evolve({executing: false})
				const dialog = Option.getOrUndefined($.model.dialog)
				if (message.operation._tag === 'Logs') {
					if (dialog?._tag !== 'Logs' || dialog.id !== message.operation.id) return next
					return next.evolve({dialog: Option.some({...dialog, result: Option.some(Result.fail(message.error))})})
				}
				return next.evolve({dialog: Option.some(DialogState.cases.Failure.make({text: message.error}))})
			},
			Posture: ($, message) => {
				if ($.model.narrow === message.narrow) return $.model
				return $.evolve({narrow: message.narrow}).viewTransition(['axis-layout'])
			},
			Retry: $ => $.run(Command.asNoop(Refresh.make({id: $.model.effectiveApp}))),
			Route: ($, message) => {
				const next = $.set({...moveTo($.model.inventory, message.route, $.model), dialog: Option.none()})
				if (usedHistoryMotion()) return next
				const show = showOf(message.route)
				const changedPane = showOf($.model.route) !== show
				const changedItem = appOf($.model.route) !== appOf(message.route)
				if ($.model.narrow && changedPane) {
					if (show === 'detail') return next.viewTransition(['axis-open'])
					return next.viewTransition(['axis-back'])
				}
				if (!$.model.narrow && (changedItem || changedPane)) return next.viewTransition(['axis-layout'])
				return next
			},
			Select: ($, {id}) => {
				const route = $.model.route
				if (!DeployRoute.isAnyOf(['Home'])(route)) return $.model
				const history = Boolean.match(showOf(route) === 'list', {
					onFalse: Function.constant('replace' as const),
					onTrue: Function.constant('push' as const)
				})
				return $.evolve({listHidden: false}).run(
					Command.asNoop(Router.patchSearch(DeployRoute, route, {app: id, pane: 'process'}, {history}))
				)
			},
			Sidebar: $ => {
				const {route, narrow, listHidden, defaultApp} = $.model
				if (!DeployRoute.isAnyOf(['Home'])(route)) return $.model
				if (!narrow) return $.evolve({listHidden: !listHidden}).viewTransition(['axis-layout'])
				if (showOf(route) === 'detail') {
					if (hasListBehind()) return $.run(Command.asNoop(Router.Back.make({})))
					return $.run(Command.asNoop(Router.patchSearch(DeployRoute, route, {pane: 'apps'})))
				}
				const app = route.search.app ?? Option.getOrUndefined(defaultApp)
				if (app === undefined) return $.model
				return $.run(Command.asNoop(Router.patchSearch(DeployRoute, route, {app, pane: 'process'}, {history: 'push'})))
			}
		},
		view: Workspace
	}),
	Component.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AtomRegistry.layer)))
)
