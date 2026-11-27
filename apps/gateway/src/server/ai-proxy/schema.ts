import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'

import {AiKeySecret, AiProvider} from '#contracts'

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
