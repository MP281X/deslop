import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {AiProvider} from '@deslop/runtime/shared/ai'
import {User} from '@deslop/runtime/shared/auth'

export {AiProvider}
export const PROVIDER_NAMES = {'opencode-go': 'OpenCode Go', 'opencode-zen': 'OpenCode Zen'} satisfies Record<
	AiProvider,
	string
>

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({provider: AiProvider, secret: Schema.RedactedFromValue(Schema.NonEmptyString)})

// One person's key for one provider; the page knows it by its last four characters and the status its last call got.
export class AiKey extends Model.Class<AiKey>('AiKey')({
	last4: Schema.String,
	lastStatus: Model.FieldOption(Schema.Int),
	owner: Model.Sensitive(User.fields.id),
	provider: AiProvider,
	secret: Model.Sensitive(AiSetKey.fields.secret)
}) {
	static readonly table = 'ai_keys'
}
export type AiKeyItem = typeof AiKey.json.Type
