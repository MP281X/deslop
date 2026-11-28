import {Schema, String} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAuth, User} from '@deslop/runtime/shared/auth'

export const KEY_MESSAGE = 'Enter an OpenCode (oc_sk_), Anthropic (sk-ant-), or OpenAI (sk-) key.'
export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['opencode', 'anthropic', 'openai'])
export type AiKeySecret = typeof AiKeySecret.Type
export const AiKeySecret = Schema.String.check(
	Schema.isPattern(/^(?:oc_sk_|sk-)[A-Za-z0-9_-]+$/u, {message: KEY_MESSAGE})
)

export function keyProvider(secret: AiKeySecret): AiProvider {
	if (String.startsWith('oc_sk_')(secret)) return 'opencode'
	if (String.startsWith('sk-ant-')(secret)) return 'anthropic'
	return 'openai'
}

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({secret: Schema.RedactedFromValue(AiKeySecret)})

export type AiKeyItem = typeof AiKeyItem.Type
export const AiKeyItem = Schema.Struct({
	last4: Schema.String,
	lastStatus: Schema.OptionFromNullOr(Schema.Int),
	provider: AiProvider
})

export const AiProxyRpcs = RpcGroup.make(
	Rpc.make('ai-proxy.key', {error: AuthError, stream: true, success: Schema.Array(AiKeyItem)}),
	Rpc.make('ai-proxy.setKey', {error: AuthError, payload: AiSetKey})
).middleware(RpcAuth)

// One person's provider credential; the secret never returns to the page.
export class AiKey extends Model.Class<AiKey>('AiKey')({
	last4: Schema.String,
	lastStatus: Model.FieldOption(Schema.Int),
	owner: Model.Sensitive(User.fields.id),
	provider: AiProvider,
	secret: Model.Sensitive(Schema.RedactedFromValue(AiKeySecret))
}) {
	static readonly table = 'ai_keys'
}

// A request Gateway answers itself, without reaching the provider.
export class AiRefusalError extends Schema.TaggedError<AiRefusalError>()('AiRefusalError', {
	message: Schema.String,
	status: Schema.Int
}) {}

export type JsonBody = typeof JsonBody.Type
// An inference request's body, as both the model policy and the provider read it.
export const JsonBody = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
