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
import {ReadState, observe} from '@deslop/ui/state'
import {hasHistoryBehind, historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import {availablePorts, itemOwner, workloads} from '#contracts'
import type {MachineHistory, Row, Snapshot} from '#contracts'

import {AppActions} from '#web/inventory/actions.ts'
import {Operation, appHistoryAtom, inventoryAtom, metricsAtom} from '#web/inventory/client.ts'
import {Detail, MachineDetail} from '#web/inventory/detail.ts'
import {Dialog} from '#web/inventory/dialog.ts'
import {List} from '#web/inventory/list.ts'
import type {Focused} from '#web/inventory/list.ts'
import {LoadingApps, LoadingReadings} from '#web/inventory/loading.ts'
import {DialogState, Execute, MACHINE, Message, Model, Refresh, SignIn, signInRequested} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {rowOrder, statusLine} from '#web/inventory/rows.ts'
import {RestartReason} from '#web/inventory/traces.ts'
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
		appHistory: pipe(
			current.effectiveApp,
			Equal.equals(effectiveApp),
			Boolean.match({onFalse: () => AsyncResult.initial(), onTrue: () => current.appHistory})
		),
		defaultApp,
		effectiveApp,
		inventory,
		route
	}
}

function showOf(route: Model['route']) {
	if (!DeployRoute.isAnyOf(['Home'])(route)) return 'list'
	if (route.search.pane === 'apps' || route.search.app === undefined) return 'list'
	return 'detail'
}

function appOf(route: Model['route']) {
	if (DeployRoute.isAnyOf(['Home'])(route)) return route.search.app
	return undefined
}

function sidebar(model: Model) {
	if (model.narrow && showOf(model.route) === 'detail') {
		return {
			id: 'sidebar',
			message: Message.Sidebar(),
			symbol: 'chevron.left',
			title: 'Back'
		} satisfies ShellAction<Message>
	}
	return {
		disabled: model.narrow && appOf(model.route) === undefined && Option.isNone(model.defaultApp),
		id: 'sidebar',
		message: Message.Sidebar(),
		pressed: model.narrow || !model.listHidden,
		symbol: 'sidebar.left',
		title: 'Sidebar'
	} satisfies ShellAction<Message>
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
	if (history !== undefined && Array.isReadonlyArrayEmpty(history.samples)) {
		return Notice(h, 'No history in the last hour')
	}
	return undefined
}

function details(
	h: H,
	model: Model,
	snapshot: Snapshot,
	rows: readonly Row[],
	pending: boolean,
	row?: Row,
	metrics?: MachineHistory,
	focused?: Focused
) {
	const id = appOf(model.route)
	const loadingHistory = AsyncResult.isInitial(model.metrics)
	const status = historyStatus(h, model, snapshot)
	if (id === MACHINE) return MachineDetail(h, model.now, snapshot, status, loadingHistory, metrics)
	if (row === undefined) {
		if (id !== undefined) return Notice(h, 'App not found')
		return undefined
	}
	const app = Option.getOrUndefined(AsyncResult.value(model.appHistory))
	return Detail(h, {
		admin: model.admin,
		...(app !== undefined && {app}),
		free: availablePorts(rows),
		...(metrics !== undefined && {history: metrics}),
		...(focused?.line !== undefined && {line: focused.line}),
		loading: loadingHistory || (Option.isSome(model.effectiveApp) && AsyncResult.isInitial(model.appHistory)),
		now: model.now,
		pending,
		...(focused?.restart !== undefined && {restart: focused.restart}),
		row,
		rows,
		status
	})
}

function Workspace(h: H, model: Model) {
	const main = h.main.class('deploy axis-controls').onMount(PressFeedback({}))
	if (!DeployRoute.isAnyOf(['Home'])(model.route)) {
		return main.children(h.a.attr('href', '/').children('Back to Deploy'))
	}
	const reads: readonly AsyncResult.AsyncResult<unknown, unknown>[] = [model.inventory, model.metrics, model.appHistory]
	if (Array.some(reads, result => AsyncResult.isFailure(result) && isDeniedCause(result.cause))) {
		if (Array.some(reads, signInRequested)) return main.children(Notice(h, 'Signing in…'))
		return main.children(Notice(h, 'Access denied'))
	}
	const show = showOf(model.route)
	const snapshot = AsyncResult.value(model.inventory)
	const rows = pipe(
		snapshot,
		Option.map(value => Array.sort(workloads(value.items), rowOrder)),
		Option.getOrElse(Array.empty<Row>)
	)
	const selection = selected(rows, model.route, model.defaultApp)
	const selectedRow = Option.getOrUndefined(selection)
	const focusId = model.route.search.app ?? selectedRow?.item.id
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
		Option.map(selection, row => {
			const line = statusLine(row, model.now, restart)
			return {id: row.item.id, ...(line !== undefined && {line}), ...(restart !== undefined && {restart}), restarts}
		})
	)
	function failed() {
		return Notice(h, 'Couldn’t load apps', Message.Retry())
	}
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
					content: ReadState(model.inventory, {
						failed,
						loading: () => h.div.class('deploy-startup-detail').children(LoadingReadings(h)),
						ready: value => details(h, model, value, rows, pending, selectedRow, history, focused)
					}),
					key: focusId ?? 'detail',
					label: 'App detail'
				},
				list: {
					content: ReadState(model.inventory, {
						failed,
						loading: () => LoadingApps(h),
						ready: (value, stale) =>
							List(h, {
								admin: model.admin,
								...(focused !== undefined && {focused}),
								...(history !== undefined && {history}),
								loading: AsyncResult.isInitial(model.metrics),
								now: model.now,
								pending,
								rows,
								selected: Option.filter(Option.fromUndefinedOr(focusId), () => !model.narrow && !collapsed),
								snapshot: value,
								stale
							})
					}),
					label: 'Apps'
				},
				listHidden: collapsed,
				narrow: model.narrow,
				show
			}),
			overlays: Option.getOrUndefined(
				Option.map(model.dialog, dialog => Dialog(h, dialog, pending, Option.getOrUndefined(snapshot)))
			),
			sidebar: sidebar(model)
		})
	)
}

function completeRead(next: Component.Step<Model, Message, never>, result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (signInRequested(result)) return next.run(Command.asNoop(SignIn.make({})))
	return next
}

function settleOperation(
	$: Component.Step<Model, Message, never>,
	operation: Operation,
	outcome: Result.Result<Option.Option<string>, string>
) {
	const next = $.evolve({executing: false})
	const dialog = Option.getOrUndefined($.model.dialog)
	if (Operation.isAnyOf(['Logs'])(operation)) {
		if (dialog === undefined || !DialogState.isAnyOf(['Logs'])(dialog) || dialog.id !== operation.id) return next
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
		onFailure: error => next.evolve({dialog: Option.some(DialogState.cases.Failure.make({text: error}))}),
		onSuccess: () => {
			if (dialog === undefined) return next
			return next.evolve({dialog: Option.none()}).viewTransition(['axis-sheet-close'])
		}
	})
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
				if (dialog === undefined || ($.model.executing && DialogState.isAnyOf(['Expose'])(dialog))) return $.model
				return $.evolve({dialog: Option.none()}).viewTransition(['axis-sheet-close'])
			},
			ExposureKind: ($, message) =>
				$.evolve({
					dialog: Option.map($.model.dialog, dialog => {
						if (DialogState.isAnyOf(['Expose'])(dialog)) return {...dialog, choosing: false, kind: message.kind}
						return dialog
					})
				}),
			ExposureMenu: ($, message) =>
				$.evolve({
					dialog: Option.map($.model.dialog, dialog => {
						if (DialogState.isAnyOf(['Expose'])(dialog)) return {...dialog, choosing: message.open}
						return dialog
					})
				}),
			Inventory: ($, message) => completeRead($.set(moveTo(message.result, $.model.route, $.model)), message.result),
			Metrics: ($, message) => completeRead($.evolve({metrics: message.result}), message.result),
			OpenedExposure: ($, message) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({
					dialog: Option.some(DialogState.cases.Expose.make({choosing: false, kind: 'tailnet', port: message.port}))
				}).viewTransition(['axis-sheet-open'])
			},
			OpenedLogs: ($, message) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({
					dialog: Option.some(DialogState.cases.Logs.make({id: message.id, name: message.name, result: Option.none()})),
					executing: true
				})
					.viewTransition(['axis-sheet-open'])
					.run(Execute.make({operation: Operation.cases.Logs.make({id: message.id})}))
			},
			Operation: ($, message) => {
				if (!$.model.admin || $.model.executing) return $.model
				return $.evolve({executing: true}).run(Execute.make({operation: message.operation}))
			},
			OperationDone: ($, message) => settleOperation($, message.operation, Result.succeed(message.text)),
			OperationFailed: ($, message) => settleOperation($, message.operation, Result.fail(message.error)),
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
			Select: ($, message) => {
				if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
				const history = Boolean.match(showOf($.model.route) === 'list', {
					onFalse: Function.constant('replace' as const),
					onTrue: Function.constant('push' as const)
				})
				return $.evolve({listHidden: false}).run(
					Command.asNoop(Router.patchSearch(DeployRoute, $.model.route, {app: message.id, pane: 'process'}, {history}))
				)
			},
			Sidebar: $ => {
				if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
				if (!$.model.narrow) return $.evolve({listHidden: !$.model.listHidden}).viewTransition(['axis-layout'])
				if (showOf($.model.route) === 'detail') {
					if (
						hasHistoryBehind(previous => {
							if (previous.pathname !== '/') return false
							const pane = previous.searchParams.get('pane')
							return pane === 'apps' || (pane === null && !previous.searchParams.has('app'))
						})
					) {
						return $.run(historyBack)
					}
					return $.run(Command.asNoop(Router.patchSearch(DeployRoute, $.model.route, {pane: 'apps'})))
				}
				const app = $.model.route.search.app ?? Option.getOrUndefined($.model.defaultApp)
				if (app === undefined) return $.model
				return $.run(
					Command.asNoop(Router.patchSearch(DeployRoute, $.model.route, {app, pane: 'process'}, {history: 'push'}))
				)
			}
		},
		view: Workspace
	}),
	Component.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AtomRegistry.layer)))
)
