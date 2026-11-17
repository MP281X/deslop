import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {GitHubId, User, UserId} from '@deslop/runtime/shared/auth'

// Admins come from GITHUB_ADMINS; a member is a GitHub account an admin allowed; anyone else who signed in waits for one.
export type Role = typeof Role.Type
export const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
export const Account = Schema.Struct({
	...User.fields,
	fullName: Schema.OptionFromOptionalKey(Schema.String),
	role: Role
})

export type SignedAccount = typeof SignedAccount.Type
export const SignedAccount = Schema.Struct({...Account.fields, signOut: Schema.Boolean})

export type Person = typeof Person.Type
export const Person = Schema.Struct({...Account.fields, since: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis)})

export type MemberStatus = typeof MemberStatus.Type
export const MemberStatus = Schema.Literals(['Waiting', 'Allowed'])

// One row of `members`: a GitHub account that signed in, from its first sign-in until an admin removes or declines it.
export class Member extends Model.Class<Member>('Member')({
	fullName: Model.FieldOption(Schema.String),
	id: User.fields.id,
	name: User.fields.name,
	// When the account first asked for access, then when an admin allowed it.
	since: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	status: MemberStatus
}) {
	static readonly table = 'members'
}

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({
	id: GitHubId,
	login: Schema.NonEmptyString,
	name: Schema.OptionFromOptionalNullOr(Schema.String)
})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: UserId})
