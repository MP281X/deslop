import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Account, AdmitParams, Person, PersonParams} from '#services/people/schema.ts'
import {
	AnswerParams,
	AuthorizationStatus,
	CodeParams,
	PendingAuthorization,
	RequestParams
} from '#services/sign-ins/schema.ts'
import {FamilyParams, SignedInApp} from '#services/tokens/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('auth.lookup', {
		error: AuthError,
		payload: CodeParams,
		stream: true,
		success: Schema.Option(PendingAuthorization)
	}),
	Rpc.make('auth.answer', {error: AuthError, payload: AnswerParams}),
	Rpc.make('auth.people', {error: AuthError, stream: true, success: Schema.Array(Person)}),
	Rpc.make('auth.admit', {error: AuthError, payload: AdmitParams, success: Person}),
	Rpc.make('auth.remove', {error: AuthError, payload: PersonParams, success: Person}),
	Rpc.make('auth.apps', {error: AuthError, stream: true, success: Schema.Array(SignedInApp)}),
	Rpc.make('auth.disconnect', {error: AuthError, payload: FamilyParams})
)
	.middleware(RpcAuth)
	.merge(
		// A GitHub account an admin has not allowed yet still reads its own state, and a waiting sign-in has no account at all.
		RpcGroup.make(
			Rpc.make('auth.account', {error: AuthError, stream: true, success: Account}),
			Rpc.make('auth.wait', {error: AuthError, payload: RequestParams, stream: true, success: AuthorizationStatus})
		)
	) {}
