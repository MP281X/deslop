import {Schema} from 'effect'

import {User} from '@deslop/runtime/auth/schema'

import {SessionVia, StoredOwner} from '#services/tokens/schema.ts'

// Admins come from GITHUB_ADMINS; a member is a GitHub account an admin allowed; anyone else who signed in waits for one.
export type Role = typeof Role.Type
export const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
export const Account = Schema.Struct({...User.fields, fullName: Schema.optionalKey(Schema.String), role: Role})

// The signed-in browser's own account, and how that browser signed in.
export type SignedAccount = typeof SignedAccount.Type
export const SignedAccount = Schema.Struct({...Account.fields, via: SessionVia})

// `since` is when a waiting account asked, or when a member was allowed.
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

// The GitHub account a sign-in proved, as GitHub's API answers it.
export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({
	id: Schema.Int,
	login: Schema.NonEmptyString,
	name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: Schema.NonEmptyString})

export type PersonParams = typeof PersonParams.Type
export const PersonParams = Schema.Struct({id: Schema.NonEmptyString})
