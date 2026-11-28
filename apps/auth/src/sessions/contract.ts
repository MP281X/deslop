import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAuth, UserId} from '@deslop/runtime/shared/auth'

// A row of the sessions page; `current` marks the browser asking.
export class ListedSession extends Model.Class<ListedSession>('ListedSession')({
	address: Model.FieldOption(Schema.String),
	browser: Schema.String,
	id: Schema.String,
	lastSeenAt: Schema.DateTimeUtcFromMillis,

	current: Schema.Boolean
}) {}

export const SessionsRpcs = RpcGroup.make(
	Rpc.make('sessions.watch', {error: AuthError, stream: true, success: Schema.Array(ListedSession)})
).middleware(RpcAuth)

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
