import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {UserId} from '@deslop/runtime/shared/auth'

// What a browser's user agent says it runs on.
export type SessionDevice = typeof SessionDevice.Type
const SessionDevice = Schema.Literals(['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux'])

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

// A row of the sessions page; `current` marks the browser asking.
export class ListedSession extends Model.Class<ListedSession>('ListedSession')({
	...Struct.pick(Model.fields(CookieSession), ['address', 'browser', 'id', 'lastSeenAt']),
	current: Schema.Boolean
}) {}
