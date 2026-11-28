import {Component, Router, Subscription, UiSchema} from '@effect/ui'

import {Array, Option, Schema} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {goBack, listBehind, openItem, readState, selection, shellApp, slide} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {AppRoute, isDetail, itemOf, readItems} from './reads.ts'

import {itemsFields, itemsMessages, listItem, rowsOf} from '#items/screen.ts'

const LIST_STATUS = {failed: 'Couldn’t load items', stale: 'Items may be out of date'} as const

// The screen's model and messages: each feature's part, and the route's. The shell owns the session, the clock and the retry.
type Model = typeof Model.Type
const Model = Schema.Struct({...itemsFields, hasListBehind: Schema.Boolean, route: AppRoute})

const Message = UiSchema.TaggedEnum({...itemsMessages, Back: {}, Route: {route: AppRoute}})

function screenOf(model: Model) {
	const items = rowsOf(model.items)
	const explicitId = itemOf(model.route)
	const id = explicitId ?? Option.getOrUndefined(Option.map(Array.head(items), item => item.id))
	const item = Array.findFirst(items, candidate => candidate.id === id)
	const state = readState([model.items])
	return {
		detail: Option.getOrUndefined(item),
		failed: Option.contains(state, 'failed'),
		id,
		list: Array.map(items, listItem),
		listStatus: Option.getOrUndefined(Option.map(state, value => LIST_STATUS[value])),
		loading: AsyncResult.isInitial(model.items),
		missing: explicitId !== undefined && Option.isNone(item),
		reads: [model.items],
		routeMissing: AppRoute.isAnyOf(['NotFound'])(model.route)
	}
}

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Items',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: AppRoute})
}).make({
	init: $ => ({hasListBehind: false, items: AsyncResult.initial(), route: $.props.route}),
	parts: (p, model) => ({
		...screenOf(model),
		selection: selection(p, {
			back: Message.Back(),
			id: itemOf(model.route),
			open: isDetail(model.route),
			select: id => Message.Select({id})
		})
	}),
	subscriptions: $ => [
		Router.subscription(AppRoute, $.model.route, route => Message.Route({route})),
		AppRoute.isAnyOf(['Home'])($.model.route) &&
			Subscription.make(
				'items',
				readItems(
					reads => reads.items,
					result => Message.Items({result})
				)
			)
	],
	update: {
		Back: $ => $.run(goBack($.model, AppRoute.Home({search: {}}), {pane: 'items'})),
		Items: ($, message) => $.evolve({items: message.result}),
		Route: ($, message) =>
			slide(
				$.evolve({hasListBehind: isDetail(message.route) && $.model.hasListBehind, route: message.route}),
				isDetail,
				$.model.route,
				message.route
			),
		Select: ($, message) => {
			if (!AppRoute.isAnyOf(['Home'])($.model.route)) return $.model
			return $.evolve({hasListBehind: listBehind($.model, isDetail)}).run(
				openItem($.model.route, isDetail, {item: message.id, pane: 'item'})
			)
		}
	}
})

export type ItemsScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const ItemsApp = shellApp({
	every: '1 minute',
	missing: 'Item not found',
	name: 'template-app',
	props: Schema.Struct({route: AppRoute}),
	screen: Screen
})
