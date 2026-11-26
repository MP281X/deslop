import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Equal, Function, Layer, Option, Schema, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDenied} from '@deslop/runtime/shared/auth'
import {accountAtom} from '@deslop/runtime/web/client'
import {Button} from '@deslop/ui/control'
import {observe} from '@deslop/ui/state'

import {Operation, appHistoryAtom, inventoryAtom, metricsAtom} from '#lib/machine.ts'
import {Detail, MachineDetail} from '#routes/(home)/-detail.ts'
import {Dialog} from '#routes/(home)/-dialog.ts'
import {List, Sidebar} from '#routes/(home)/-list.ts'
import {
	DeployRoute,
	DialogState,
	Execute,
	MACHINE,
	Message,
	Model,
	Refresh,
	SignIn,
	signInRequested
} from '#routes/(home)/-model.ts'
import {rowOrder} from '#routes/(home)/-rows.ts'
import {availablePorts, itemOwner, workloads} from '#services/inventory/lib/utils.ts'
import type {Row} from '#services/inventory/lib/utils.ts'

type H = Html.H<Message>

function selected(rows: ReturnType<typeof workloads>, route: Model['route'], defaultApp: Model['defaultApp']) {
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

function Notice(h: H, text: string, retry = false) {
	return h.div
		.class('deploy-notice')
		.attr('role', 'status')
		.children(
			h.p.children(text),
			retry &&
				Button(h, {})
					.on('click', () => Message.Retry())
					.children('Retry')
		)
}

function historyStatus(h: H, model: Model, problems: readonly string[]) {
	const history = Option.getOrUndefined(AsyncResult.value(model.metrics))
	if (
		AsyncResult.isFailure(model.inventory) ||
		AsyncResult.isFailure(model.metrics) ||
		AsyncResult.isFailure(model.appHistory)
	) {
		if (history === undefined) return Notice(h, 'Couldn’t load history', true)
		return Notice(h, 'Out of date', true)
	}
	if (Array.isReadonlyArrayNonEmpty(problems)) return Notice(h, Array.join(problems, ' · '))
	if (AsyncResult.isInitial(model.metrics)) return Notice(h, 'Loading history…')
	if (history === undefined) return undefined
	if (Array.isReadonlyArrayEmpty(history.samples)) return Notice(h, 'No history in the last hour')
	if (history.stale) return Notice(h, 'History is out of date')
	return undefined
}

function Workspace(h: H, model: Model) {
	if (!DeployRoute.isAnyOf(['Home'])(model.route)) {
		return h.main.class('deploy-notice').children(h.a.attr('href', '/').children('Back to Deploy'))
	}
	const readers: readonly AsyncResult.AsyncResult<unknown, unknown>[] = [
		model.inventory,
		model.metrics,
		model.appHistory
	]
	if (Array.some(readers, result => Option.exists(AsyncResult.error(result), isDenied))) {
		if (Array.some(readers, signInRequested)) return Notice(h, 'Signing in…')
		return Notice(h, 'Access denied')
	}
	const snapshot = Option.getOrUndefined(AsyncResult.value(model.inventory))
	if (snapshot === undefined) {
		if (AsyncResult.isInitial(model.inventory)) return Notice(h, 'Loading apps…')
		return Notice(h, 'Couldn’t load apps', true)
	}
	const history = AsyncResult.value(model.metrics)
	const app = AsyncResult.value(model.appHistory)
	const rows = Array.sort(workloads(snapshot.items), rowOrder)
	const selectedRow = selected(rows, model.route, model.defaultApp)
	const machine = model.route.search.app === MACHINE
	const implicitApp = model.route.search.app === undefined
	const isList = model.route.search.pane === 'apps' || implicitApp
	const id = Boolean.match(machine, {
		onFalse: () => Option.map(selectedRow, row => row.item.id),
		onTrue: () => Option.some(MACHINE)
	})
	const status = historyStatus(h, model, [
		...Array.flatMap(snapshot.sources, source =>
			Option.toArray(Option.map(source.error, reason => `${source.name}: ${reason}`))
		),
		...Option.toArray(Option.flatMap(history, frame => frame.error))
	])
	const sidebar = [
		Sidebar(h, false, Message.ShowList({id}), 'deploy-side-phone'),
		model.listHidden && Sidebar(h, false, Message.ToggleList(), 'deploy-side-wide')
	]
	const detail = Boolean.match(machine, {
		onFalse: () =>
			Option.match(selectedRow, {
				onNone: () =>
					h.div
						.class('axis-row deploy-detail-lead')
						.children(
							sidebar,
							h.span.children(
								Boolean.match(implicitApp, {
									onFalse: Function.constant('App not found'),
									onTrue: Function.constant('No apps')
								})
							)
						),
				onSome: row =>
					Detail(h, {
						admin: model.admin,
						...pipe(
							app,
							Option.map(frame => ({app: frame})),
							Option.getOrElse(Function.constant({}))
						),
						free: availablePorts(rows),
						...pipe(
							history,
							Option.map(frame => ({history: frame})),
							Option.getOrElse(Function.constant({}))
						),
						now: model.now,
						pending: model.pending,
						row,
						rows,
						sidebar,
						status
					})
			}),
		onTrue: () => MachineDetail(h, model.now, snapshot, sidebar, status, Option.getOrUndefined(history))
	})
	return h.main
		.class('deploy fold')
		.attrs({
			'data-list-hidden': Boolean.match(model.listHidden, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('')
			}),
			'data-show': Boolean.match(isList, {onFalse: Function.constant('detail'), onTrue: Function.constant('list')})
		})
		.children(
			h.section
				.class('fold-list')
				.attr('aria-label', 'Apps')
				.children(
					List(h, {
						admin: model.admin,
						...pipe(
							history,
							Option.map(frame => ({history: frame})),
							Option.getOrElse(Function.constant({}))
						),
						now: model.now,
						pending: model.pending,
						...pipe(
							app,
							Option.map(frame => ({processes: frame})),
							Option.getOrElse(Function.constant({}))
						),
						rows,
						selected: id,
						snapshot
					})
				),
			h.section.class('fold-detail').attr('aria-label', 'App detail').children(detail),
			Option.getOrUndefined(Option.map(model.dialog, dialog => Dialog(h, dialog, snapshot, model.pending)))
		)
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
			inventory: AsyncResult.initial(),
			listHidden: false,
			metrics: AsyncResult.initial(),
			now: DateTime.nowUnsafe(),
			pending: false,
			route: $.props.route
		}),
		subscriptions: $ => [
			Router.subscription(DeployRoute, $.model.route, route => Message.Route({route})),
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
				const next = $.evolve({appHistory: message.result})
				if (signInRequested(message.result)) return next.run(Command.asNoop(SignIn.make({})))
				return next
			},
			Clock: ($, message) => $.evolve({now: message.now}),
			ClosedDialog: $ => {
				if ($.model.pending && Option.exists($.model.dialog, DialogState.isAnyOf(['Expose']))) return $.model
				return $.evolve({dialog: Option.none()})
			},
			ExposureKind: ($, message) =>
				$.evolve({
					dialog: Option.map($.model.dialog, current => {
						if (DialogState.isAnyOf(['Expose'])(current)) {
							return DialogState.cases.Expose.make({kind: message.kind, port: current.port})
						}
						return current
					})
				}),
			Inventory: ($, message) => {
				const next = $.set(moveTo(message.result, $.model.route, $.model))
				if (signInRequested(message.result)) return next.run(Command.asNoop(SignIn.make({})))
				return next
			},
			Metrics: ($, message) => {
				const next = $.evolve({metrics: message.result})
				if (signInRequested(message.result)) return next.run(Command.asNoop(SignIn.make({})))
				return next
			},
			OpenedExposure: ($, message) => {
				if (!$.model.admin || $.model.pending) return $.model
				return $.evolve({dialog: Option.some(DialogState.cases.Expose.make({kind: 'tailnet', port: message.port}))})
			},
			OpenedLogs: ($, message) => {
				if (!$.model.admin || $.model.pending) return $.model
				return $.evolve({
					dialog: Option.some(DialogState.cases.Logs.make({name: message.name, text: Option.none()})),
					pending: true
				}).run(Execute.make({operation: Operation.cases.Logs.make({id: message.id})}))
			},
			Operation: ($, message) => {
				if (!$.model.admin || $.model.pending) return $.model
				return $.evolve({pending: true}).run(Execute.make({operation: message.operation}))
			},
			OperationDone: ($, message) =>
				$.evolve({
					dialog: Option.map(
						pipe(
							$.model.dialog,
							Option.filter(() => Operation.isAnyOf(['Logs'])(message.operation)),
							Option.filter(DialogState.isAnyOf(['Logs']))
						),
						logs => DialogState.cases.Logs.make({name: logs.name, text: message.text})
					),
					pending: false
				}),
			OperationFailed: ($, message) =>
				$.evolve({dialog: Option.some(DialogState.cases.Failure.make({text: message.error})), pending: false}),
			Retry: $ => $.run(Command.asNoop(Refresh.make({id: $.model.effectiveApp}))),
			Route: ($, message) => $.set({...moveTo($.model.inventory, message.route, $.model), dialog: Option.none()}),
			Select: ($, message) => {
				if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.run(
					Command.asNoop(
						Router.patchSearch(DeployRoute, $.model.route, {app: message.id, pane: 'process'}, {history: 'push'})
					)
				)
			},
			ShowList: ($, message) => {
				if (!DeployRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({listHidden: false}).run(
					Command.asNoop(
						Router.patchSearch(
							DeployRoute,
							$.model.route,
							{app: Option.getOrUndefined(message.id), pane: 'apps'},
							{history: 'push'}
						)
					)
				)
			},
			ToggleList: $ => $.evolve({listHidden: !$.model.listHidden})
		},
		view: Workspace
	}),
	Component.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AtomRegistry.layer)))
)
