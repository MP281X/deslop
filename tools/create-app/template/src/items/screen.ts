import {Array, Option, Schema} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {Item} from './contract.ts'

const ItemsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Item)})
export type ItemsRead = typeof ItemsRead.Type

// This part of the screen's model and the messages that fill it.
export const itemsFields = {items: ItemsRead}
export const itemsMessages = {Items: {result: ItemsRead}, Select: {id: Schema.String}}

export function rowsOf(items: ItemsRead) {
	return Option.getOrElse(AsyncResult.value(items), Array.empty<Item>)
}

export function listItem(item: Item) {
	return {id: item.id, line: item.line, title: item.title}
}
