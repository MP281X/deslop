import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAdmin, RpcAuth, User, UserId} from '@deslop/runtime/shared/auth'

import {TailnetUserId} from '#tailnet/contract.ts'

// Admins come from GITHUB_ADMINS; a member is someone the tailnet has seen or a GitHub account an admin allowed; anyone else who signed in from a browser waits for one.
export type Role = typeof Role.Type
const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
export const Account = Schema.Struct({
	...User.fields,
	fullName: Schema.OptionFromOptionalKey(Schema.String),
	role: Role
})

export type Person = typeof Person.Type
export const Person = Schema.Struct({...Account.fields, since: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis)})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: UserId})

export const PeopleRpcs = RpcGroup.make(
	Rpc.make('people.watch', {error: AuthError, stream: true, success: Schema.Array(Person)}).middleware(RpcAdmin),
	Rpc.make('people.admit', {error: AuthError, payload: AdmitParams, success: Person}).middleware(RpcAdmin)
).middleware(RpcAuth)

export type MemberStatus = typeof MemberStatus.Type
export const MemberStatus = Schema.Literals(['Waiting', 'Allowed'])

// One row of `members`: a person who signed in or was seen on the tailnet, until an admin removes them or declines the only way they came.
export class Member extends Model.Class<Member>('Member')({
	fullName: Model.FieldOption(Schema.String),
	id: User.fields.id,
	name: User.fields.name,
	// When the person was first seen or first asked for access, then when an admin allowed their browser.
	since: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	// A browser's access, which only a GitHub sign-in asks for; none for someone seen only on the tailnet or declined.
	status: Model.FieldOption(MemberStatus),
	// The tailnet lets them in from their own devices, and apps acting for them, without an admin.
	tailnet: Schema.BooleanFromBit
}) {
	static readonly table = 'members'
}

// One row of `tailnet_bindings`: the GitHub account a tailnet user's first sighting resolved, until that person is removed.
export class Binding extends Model.Class<Binding>('Binding')({tailnetId: TailnetUserId, userId: User.fields.id}) {
	static readonly table = 'tailnet_bindings'
}
