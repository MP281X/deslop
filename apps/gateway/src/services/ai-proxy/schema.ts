import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'

export const CONNECTION_MESSAGE = 'Enter the full HTTPS Console API URL, not a key.'
export const KEY_MESSAGE = 'Enter an OpenCode service account key starting with oc_sk_, not an address.'

export type ConnectionUrl = typeof ConnectionUrl.Type
export const ConnectionUrl = Schema.String.check(
	Schema.isPattern(/^https:\/\/opencode\.ai\/inference\/custom\/conn_[A-Za-z0-9_-]+$/u, {message: CONNECTION_MESSAGE})
)
export type ServiceAccountKey = typeof ServiceAccountKey.Type
export const ServiceAccountKey = Schema.String.check(
	Schema.isPattern(/^oc_sk_[A-Za-z0-9_-]+$/u, {message: KEY_MESSAGE})
)

// One person's OpenCode credential and optional connected-Claude address; the secret never returns to the page.
export class AiKey extends Model.Class<AiKey>('AiKey')({
	connectionUrl: Model.FieldOption(ConnectionUrl),
	last4: Schema.String,
	lastStatus: Model.FieldOption(Schema.Int),
	owner: Model.Sensitive(User.fields.id),
	secret: Model.Sensitive(Schema.RedactedFromValue(ServiceAccountKey))
}) {
	static readonly table = 'ai_keys'
}

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({
	connectionUrl: Schema.OptionFromOptionalKey(ConnectionUrl),
	secret: Schema.OptionFromOptionalKey(Schema.RedactedFromValue(ServiceAccountKey))
})

export type AiKeyItem = typeof AiKeyItem.Type
export const AiKeyItem = Schema.Struct(Struct.pick(AiKey.fields, ['connectionUrl', 'last4', 'lastStatus']))
