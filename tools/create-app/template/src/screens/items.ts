import {Command, Component, Query, Router, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Effect, Function, Layer, Option, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import type {HttpClient} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'
import {RpcClient} from 'effect/rpc'

import {readAccount} from '@deslop/runtime/client/account'
import {needsSignInCause} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {Account} from '@deslop/runtime/shared/schema'

import {Item, RpcContracts} from '#contracts'

import {AppRoute, CloseItem} from '#screens/routes.ts'

const SHEET = {action: 'Done', body: 'This example uses the same item on web and iPhone.', title: 'About this item'}

class Viewer extends Query.Service<Viewer>()('Items/Viewer', {
	args: {},
	error: AuthError,
	staleTime: '30 seconds',
	success: Account
}) {}

export class Items extends Query.Service<Items>()('Items/List', {
	args: {},
	error: Schema.String,
	staleTime: '30 seconds',
	success: Schema.Array(Item)
}) {}

const itemsClient = RpcClient.make(RpcContracts.middleware(RpcStream))
export const readItems = Effect.map(
	itemsClient,
	rpc => () => Effect.mapError(rpc['items.list'](), Function.constant('Items could not be loaded'))
)
export const layerItems = Items.toLayer(readItems)

export function layerViewer(read = readAccount('')) {
	return Layer.provide(
		Viewer.toLayer(
			Effect.map(Effect.context<HttpClient.HttpClient>(), context => () => Effect.provideContext(read, context))
		),
		FetchHttpClient.layer
	)
}

const Retry = Command.make('Items/Retry', {args: {}}, () => Effect.andThen(Viewer.invalidate(), Items.invalidate()))
export const RefreshViewer = Command.make('Items/RefreshViewer', {args: {}}, () => Viewer.invalidate())

const Message = UiSchema.TaggedEnum({Back: {}, Opened: {id: Schema.String}, Retried: {}, Routed: {route: AppRoute}})

const ItemsScreen = Component.define({
	message: Message,
	model: Schema.Struct({route: AppRoute}),
	name: 'ItemsScreen',
	props: Schema.Struct({route: AppRoute}),
	queries: {
		viewer: {args: () => ({}), query: Viewer},

		items: {
			args: $ => {
				if (AppRoute.isAnyOf(['NotFound'])($.model.route)) return undefined
				if (!Option.exists(AsyncResult.value($.queries.viewer), account => account.admin)) return undefined
				return {}
			},
			query: Items
		}
	}
}).make({
	init: $ => ({route: $.props.route}),
	parts: (p, model) => {
		const id = AppRoute.match(model.route, {
			Item: route => route.params.id,
			List: Function.constUndefined,
			NotFound: Function.constUndefined
		})
		const items: readonly Item[] = Option.getOrElse(AsyncResult.value(p.queries.items), () => [])
		const selected = Array.findFirst(items, item => item.id === id)
		const viewer = AsyncResult.value(p.queries.viewer)
		const signIn = AsyncResult.isFailure(p.queries.viewer) && needsSignInCause(p.queries.viewer.cause)
		function problemOf() {
			if (AppRoute.isAnyOf(['NotFound'])(model.route)) return 'Item not found'
			if (AsyncResult.isSuccess(p.queries.items) && id !== undefined && Option.isNone(selected)) {
				return 'Item not found'
			}
			if (signIn) return 'Sign in required'
			if (AsyncResult.isFailure(p.queries.viewer)) return 'Account could not be loaded'
			if (Option.exists(viewer, account => !account.admin)) return 'Admin access required'
			if (AsyncResult.isFailure(p.queries.items)) return 'Items could not be loaded'
			return undefined
		}

		const problem = problemOf()
		const selection = {
			back: p.part((el, event: string) => el.on(event, Message.Back())),
			id,
			select: p.part((el, event: string, itemId: string) => el.on(event, Message.Opened({id: itemId})))
		}
		return {
			body: pipe(
				selected,
				Option.map(item => item.body),
				Option.getOrElse(Function.constant(''))
			),
			list: {loading: AsyncResult.isInitial(p.queries.items), rows: items, selection, sheet: SHEET},
			problem,
			retry: p.part((el, event: string) => el.on(event, Message.Retried())),
			retryable: AsyncResult.isFailure(p.queries.viewer) || AsyncResult.isFailure(p.queries.items),
			signIn
		}
	},
	subscriptions: $ => [Router.subscription(AppRoute, $.model.route, route => Message.Routed({route}))],
	update: {
		Back: $ => $.run(Command.asNoop(CloseItem.make({}))),
		Opened: ($, message) => {
			const route = AppRoute.Item({params: {id: message.id}})
			if (AppRoute.isAnyOf(['Item'])($.model.route)) return $.run(Command.asNoop(Router.replace(AppRoute, route)))
			return $.run(Command.asNoop(Router.push(AppRoute, route)))
		},
		Retried: $ => $.run(Command.asNoop(Retry.make({}))),
		Routed: ($, message) => {
			const next = $.evolve({route: message.route})
			if (AppRoute.isAnyOf(['List'])($.model.route) && AppRoute.isAnyOf(['Item'])(message.route)) {
				return next.viewTransition(['design-detail-in'])
			}
			if (AppRoute.isAnyOf(['Item'])($.model.route) && AppRoute.isAnyOf(['List'])(message.route)) {
				return next.viewTransition(['design-detail-out'])
			}
			return next
		}
	}
})

export type ScreenParts = Component.Headless.Parts<typeof ItemsScreen>

export function ItemsView<M, R>(
	h: View.HelperBase<M, unknown>,
	props: {readonly route: AppRoute},
	display: {
		readonly list: (list: ScreenParts['list'], body: string) => View.Content<M, R>
		readonly problem: (problem: string, screen: ScreenParts) => View.Content<M, R>
	}
) {
	return ItemsScreen(h, {
		props,
		view: screen => {
			if (screen.problem !== undefined) return display.problem(screen.problem, screen)
			return display.list(screen.list, screen.body)
		}
	})
}
