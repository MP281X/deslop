import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'

export const KEY_MESSAGE = 'Enter an OpenCode key starting with oc_sk_ or an Anthropic API key starting with sk-ant-.'
export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['opencode', 'anthropic'])
export type AiKeySecret = typeof AiKeySecret.Type
export const AiKeySecret = Schema.String.check(
	Schema.isPattern(/^(?:oc_sk_|sk-ant-)[A-Za-z0-9_-]+$/u, {message: KEY_MESSAGE})
)

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

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({secret: Schema.RedactedFromValue(AiKeySecret)})

export type AiKeyItem = typeof AiKeyItem.Type
export const AiKeyItem = Schema.Struct(Struct.pick(AiKey.fields, ['provider', 'last4', 'lastStatus']))
