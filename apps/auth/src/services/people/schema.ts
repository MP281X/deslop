import {DateTime, Function, Option, Schema, SchemaGetter, pipe} from 'effect'

import {Model} from 'effect/schema'

import {GitHubId, User, UserId} from '@deslop/runtime/shared/auth'

import {CredentialOwner, SessionVia} from '#services/tokens/schema.ts'

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
export const SignedAccount = Schema.Struct({...Account.fields, via: SessionVia})

export type Person = typeof Person.Type
export const Person = Schema.Struct({
	...Account.fields,
	// An admin whose profile has not arrived has no membership date; the existing wire encodes that as zero.
	since: pipe(
		Schema.Finite,
		Schema.decodeTo(Schema.Option(Schema.DateTimeUtc), {
			decode: SchemaGetter.transform(value =>
				pipe(
					value,
					Option.liftPredicate(time => time !== 0),
					Option.map(DateTime.makeUnsafe)
				)
			),
			encode: SchemaGetter.transform(value =>
				Option.match(value, {onNone: Function.constant(0), onSome: DateTime.toEpochMillis})
			)
		})
	)
})

export type MemberStatus = typeof MemberStatus.Type
export const MemberStatus = Schema.Literals(['Waiting', 'Allowed'])

// One row of `members`: a GitHub account that signed in, from its first sign-in until an admin removes or declines it.
export class Member extends Model.Class<Member>('Member')({
	fullName: Model.FieldOption(Schema.String),
	id: User.fields.id,
	// The registration its credentials belong to; it never leaves the server.
	incarnation: Model.Sensitive(CredentialOwner.fields.incarnation),
	name: User.fields.name,
	// When the account first asked for access, then when an admin allowed it.
	since: Schema.DateTimeUtcFromMillis,
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
