import {Command, Component, Query, Router, UiSchema} from '@effect/ui'

import {Array, Effect, Function, Layer, Option, Schema} from 'effect'

import {FetchHttpClient, HttpClient} from 'effect/http'
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
	success: Account,
	staleTime: '30 seconds'
}) {}

class Items extends Query.Service<Items>()('Items/List', {
	args: {},
	error: Schema.String,
	success: Schema.Array(Item),
	staleTime: '30 seconds'
}) {}

export const layerItems = Items.toLayer(
	Effect.map(
		RpcClient.make(RpcContracts.middleware(RpcStream)),
		rpc => () => Effect.mapError(rpc['items.list'](), Function.constant('Items could not be loaded'))
	)
)

export function layerViewer(origin: string) {
	return Viewer.toLayer(
		Effect.map(
			Effect.context<HttpClient.HttpClient>(),
			context => () => Effect.provideContext(readAccount(origin), context)
		)
	).pipe(Layer.provide(FetchHttpClient.layer))
}

const Retry = Command.make('Items/Retry', {args: {}}, () => Effect.andThen(Viewer.invalidate(), Items.invalidate()))

const Message = UiSchema.TaggedEnum({Back: {}, Opened: {id: Schema.String}, Retried: {}, Routed: {route: AppRoute}})

export const ItemsScreen = Component.define({
	name: 'ItemsScreen',
	props: Schema.Struct({route: AppRoute}),
	model: Schema.Struct({route: AppRoute}),
	message: Message,
	queries: {
		viewer: {query: Viewer, args: () => ({})},
		items: {
			query: Items,
			args: ({model, queries}) =>
				model.route._tag !== 'NotFound' && Option.exists(AsyncResult.value(queries.viewer), account => account.admin)
					? {}
					: undefined
		}
	}
}).make({
	init: ({props}) => ({route: props.route}),
	subscriptions: ({model}) => [Router.subscription(AppRoute, model.route, route => Message.Routed({route}))],
	update: {
		Back: $ => $.run(Command.asNoop(CloseItem.make({}))),
		Opened: ($, {id}) => $.run(Command.asNoop(OpenItem.make({id}))),
		Retried: $ => $.run(Command.asNoop(Retry.make({}))),
		Routed: ($, {route}) => {
			const next = $.evolve({route})
			if ($.model.route._tag === 'List' && route._tag === 'Item') return next.viewTransition(['design-detail-in'])
			if ($.model.route._tag === 'Item' && route._tag === 'List') return next.viewTransition(['design-detail-out'])
			return next
		}
	},
	parts: (p, {route}) => {
		const id = route._tag === 'Item' ? route.params.id : undefined
		const items = Option.getOrElse(AsyncResult.value(p.queries.items), () => [])
		const viewer = AsyncResult.value(p.queries.viewer)
		const signIn = AsyncResult.isFailure(p.queries.viewer) && needsSignInCause(p.queries.viewer.cause)
		const problem =
			route._tag === 'NotFound' ||
			(AsyncResult.isSuccess(p.queries.items) && id !== undefined && !Array.some(items, item => item.id === id))
				? 'Item not found'
				: signIn
					? 'Sign in required'
					: AsyncResult.isFailure(p.queries.viewer)
						? 'Account could not be loaded'
						: Option.exists(viewer, account => !account.admin)
							? 'Admin access required'
							: AsyncResult.isFailure(p.queries.items)
								? 'Items could not be loaded'
								: undefined
		return {
			items,
			body: Option.getOrElse(
				Option.map(
					Array.findFirst(items, item => item.id === id),
					item => item.body
				),
				() => ''
			),
			problem,
			signIn,
			retryable: AsyncResult.isFailure(p.queries.viewer) || AsyncResult.isFailure(p.queries.items),
			loading: problem === undefined && AsyncResult.isInitial(p.queries.items),
			selection: {
				id,
				select: p.part((el, event: string, id: string) => el.on(event, Message.Opened({id}))),
				back: p.part((el, event: string) => el.on(event, Message.Back()))
			},
			retry: p.part((el, event: string) => el.on(event, Message.Retried()))
		}
	}
})

export const sheet = {
	action: 'Done',
	body: 'This example uses the same item on web and iPhone.',
	title: 'About this item'
}
