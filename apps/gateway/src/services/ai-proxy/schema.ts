import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'

export type ConnectionUrl = typeof ConnectionUrl.Type
export const ConnectionUrl = Schema.String.check(
	Schema.isPattern(/^https:\/\/opencode\.ai\/inference\/custom\/conn_[A-Za-z0-9_-]+$/u)
)

// One person's OpenCode credential and optional connected-Claude address; the secret never returns to the page.
export class AiKey extends Model.Class<AiKey>('AiKey')({
	connectionUrl: Model.FieldOption(ConnectionUrl),
	last4: Schema.String,
	lastStatus: Model.FieldOption(Schema.Int),
	owner: Model.Sensitive(User.fields.id),
	secret: Model.Sensitive(Schema.RedactedFromValue(Schema.NonEmptyString))
}) {
	static readonly table = 'ai_keys'
}

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({
	connectionUrl: Schema.OptionFromOptionalKey(ConnectionUrl),
	secret: Schema.OptionFromOptionalKey(Schema.RedactedFromValue(Schema.NonEmptyString))
})

export type AiKeyItem = typeof AiKeyItem.Type
export const AiKeyItem = Schema.Struct(Struct.pick(AiKey.fields, ['connectionUrl', 'last4', 'lastStatus']))
