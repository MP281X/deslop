import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError} from '@deslop/runtime/shared/auth'

export class ItemsError extends Schema.TaggedError<ItemsError>()('ItemsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export class Item extends Model.Class<Item>('Item')({
	body: Schema.String,
	id: Schema.String,
	line: Schema.String,
	title: Schema.String
}) {
	static readonly table = 'items'
}

export const ItemsRpcs = RpcGroup.make(
	Rpc.make('items.watch', {error: Schema.Union([AuthError, ItemsError]), stream: true, success: Schema.Array(Item)})
)
