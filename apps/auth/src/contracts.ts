import {Array, Option, Result, Schema, String, pipe} from 'effect'

import {Url} from 'effect/http'
import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAdmin, RpcAuth, User, UserId} from '@deslop/runtime/shared/auth'

// Admins come from GITHUB_ADMINS; a member is someone the tailnet has seen or a GitHub account an admin allowed; anyone else who signed in from a browser waits for one.
export type Role = typeof Role.Type
const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
const Account = Schema.Struct({...User.fields, fullName: Schema.OptionFromOptionalKey(Schema.String), role: Role})

export type SignedAccount = typeof SignedAccount.Type
export const SignedAccount = Schema.Struct({...Account.fields, signOut: Schema.Boolean})

export type Person = typeof Person.Type
export const Person = Schema.Struct({...Account.fields, since: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis)})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: UserId})

// A row of the sessions page; `current` marks the browser asking.
export class ListedSession extends Model.Class<ListedSession>('ListedSession')({
	address: Model.FieldOption(Schema.String),
	browser: Schema.String,
	id: Schema.String,
	lastSeenAt: Schema.DateTimeUtcFromMillis,

	current: Schema.Boolean
}) {}

export const PeopleRpcs = RpcGroup.make(
	Rpc.make('people.watch', {error: AuthError, stream: true, success: Schema.Array(Person)}).middleware(RpcAdmin),
	Rpc.make('people.admit', {error: AuthError, payload: AdmitParams, success: Person}).middleware(RpcAdmin)
).middleware(RpcAuth)

export const SessionsRpcs = RpcGroup.make(
	Rpc.make('sessions.watch', {error: AuthError, stream: true, success: Schema.Array(ListedSession)})
).middleware(RpcAuth)

export const IdentityRpcs = RpcGroup.make(
	Rpc.make('people.account', {error: AuthError, stream: true, success: SignedAccount})
)

export const RpcContracts = PeopleRpcs.merge(SessionsRpcs, IdentityRpcs)

export function parentDomain(canonical: string) {
	return pipe(new URL(canonical).hostname, String.split('.'), Array.drop(1), Array.join('.'))
}
// The parsed URL, not the string that was checked: parsing drops characters, such as a newline, that no Location header may carry.
export function returnTarget(next: string, canonical: string, local: boolean) {
	return pipe(
		Result.getSuccess(Url.fromString(next)),
		Option.filter(target => {
			if (target.username !== '' || target.password !== '') return false
			if (local) return target.origin === new URL(canonical).origin
			return (
				target.protocol === 'https:' &&
				(target.hostname === parentDomain(canonical) || String.endsWith(`.${parentDomain(canonical)}`)(target.hostname))
			)
		}),
		Option.map(target => target.href)
	)
}
