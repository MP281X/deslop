import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {UserId} from '@deslop/runtime/shared/auth'

// One browser signed in at Auth; its cookie holds the secret whose hash is the id.
export class CookieSession extends Model.Class<CookieSession>('CookieSession')({
	address: Model.FieldOption(Schema.String),
	browser: Schema.String,
	createdAt: Schema.DateTimeUtcFromMillis,
	id: Schema.String,
	lastSeenAt: Schema.DateTimeUtcFromMillis,
	userId: UserId
}) {
	static readonly table = 'cookie_sessions'
}
