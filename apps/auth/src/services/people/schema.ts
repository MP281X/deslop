import {Schema} from 'effect'

import {User} from '@deslop/runtime/auth/schema'

import {SessionVia, StoredOwner} from '#services/tokens/schema.ts'

// Admins come from GITHUB_ADMINS; a member is a GitHub account an admin allowed; anyone else who signed in waits for one.
export type Role = typeof Role.Type
export const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
export const Account = Schema.Struct({...User.fields, fullName: Schema.optionalKey(Schema.String), role: Role})

export type SignedAccount = typeof SignedAccount.Type
export const SignedAccount = Schema.Struct({...Account.fields, via: SessionVia})

export type Person = typeof Person.Type
export const Person = Schema.Struct({...Account.fields, since: Schema.Finite})

export type MemberStatus = typeof MemberStatus.Type
export const MemberStatus = Schema.Literals(['Waiting', 'Allowed'])

export type MemberRow = typeof MemberRow.Type
export const MemberRow = Schema.Struct({
	fullName: Schema.String,
	id: Schema.NonEmptyString,
	incarnation: StoredOwner.fields.incarnation,
	name: Schema.NonEmptyString,
	since: Schema.Finite,
	status: MemberStatus
})

export type Members = typeof Members.Type
export const Members = Schema.Array(MemberRow)

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({
	id: Schema.Int,
	login: Schema.NonEmptyString,
	name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: Schema.NonEmptyString})
