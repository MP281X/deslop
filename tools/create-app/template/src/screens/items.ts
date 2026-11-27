import {Command, Component, Query, Router, UiSchema} from '@effect/ui'

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

import {AppRoute, CloseItem, OpenItem} from '#screens/routes.ts'

class Viewer extends Query.Service<Viewer>()('Items/Viewer', {
	args: {},
	error: AuthError,
	staleTime: '30 seconds',
	success: Account
}) {}

class Items extends Query.Service<Items>()('Items/List', {
	args: {},
	error: Schema.String,
	staleTime: '30 seconds',
	success: Schema.Array(Item)
}) {}

export const layerItems = Items.toLayer(
	Effect.map(
		RpcClient.make(RpcContracts.middleware(RpcStream)),
		rpc => () => Effect.mapError(rpc['items.list'](), Function.constant('Items could not be loaded'))
	)
)

export function layerViewer(origin: string) {
	return Layer.provide(
		Viewer.toLayer(
			Effect.map(
				Effect.context<HttpClient.HttpClient>(),
				context => () => Effect.provideContext(readAccount(origin), context)
			)
		),
		FetchHttpClient.layer
	)
}

const Retry = Command.make('Items/Retry', {args: {}}, () => Effect.andThen(Viewer.invalidate(), Items.invalidate()))

const Message = UiSchema.TaggedEnum({Back: {}, Opened: {id: Schema.String}, Retried: {}, Routed: {route: AppRoute}})

export const ItemsScreen = Component.define({
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
		const items = Option.getOrElse(AsyncResult.value(p.queries.items), () => [])
		const viewer = AsyncResult.value(p.queries.viewer)
		const signIn = AsyncResult.isFailure(p.queries.viewer) && needsSignInCause(p.queries.viewer.cause)
		function problemOf() {
			if (AppRoute.isAnyOf(['NotFound'])(model.route)) return 'Item not found'
			if (AsyncResult.isSuccess(p.queries.items) && id !== undefined && !Array.some(items, item => item.id === id)) {
				return 'Item not found'
			}
			if (signIn) return 'Sign in required'
			if (AsyncResult.isFailure(p.queries.viewer)) return 'Account could not be loaded'
			if (Option.exists(viewer, account => !account.admin)) return 'Admin access required'
			if (AsyncResult.isFailure(p.queries.items)) return 'Items could not be loaded'
			return undefined
		}

		const problem = problemOf()
		return {
			body: pipe(
				items,
				Array.findFirst(item => item.id === id),
				Option.map(item => item.body),
				Option.getOrElse(Function.constant(''))
			),
			items,
			loading: problem === undefined && AsyncResult.isInitial(p.queries.items),
			problem,
			retry: p.part((el, event: string) => el.on(event, Message.Retried())),
			retryable: AsyncResult.isFailure(p.queries.viewer) || AsyncResult.isFailure(p.queries.items),
			selection: {
				back: p.part((el, event: string) => el.on(event, Message.Back())),
				id,
				select: p.part((el, event: string, itemId: string) => el.on(event, Message.Opened({id: itemId})))
			},
			signIn
		}
	},
	subscriptions: $ => [Router.subscription(AppRoute, $.model.route, route => Message.Routed({route}))],
	update: {
		Back: $ => $.run(Command.asNoop(CloseItem.make({}))),
		Opened: ($, message) => $.run(Command.asNoop(OpenItem.make({id: message.id}))),
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

export const sheet = {
	action: 'Done',
	body: 'This example uses the same item on web and iPhone.',
	title: 'About this item'
}
