import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {
	Account,
	AdmitParams,
	AuthorizationStatus,
	CodeParams,
	FamilyParams,
	PendingAuthorization,
	Person,
	PersonParams,
	RequestParams,
	SignedInApp
} from '#services/authorizations/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('auth.lookup', {
		error: AuthError,
		payload: CodeParams,
		stream: true,
		success: Schema.Option(PendingAuthorization)
	}),
	Rpc.make('auth.people', {error: AuthError, stream: true, success: Schema.Array(Person)}),
	Rpc.make('auth.admit', {error: AuthError, payload: AdmitParams, success: Person}),
	Rpc.make('auth.remove', {error: AuthError, payload: PersonParams, success: Person}),
	Rpc.make('auth.apps', {error: AuthError, stream: true, success: Schema.Array(SignedInApp)}),
	Rpc.make('auth.disconnect', {error: AuthError, payload: FamilyParams})
)
	.middleware(RpcAuth)
	.merge(
		// A GitHub account an admin has not allowed yet still reads its own state, so these two need no allowed session.
		RpcGroup.make(
			Rpc.make('auth.account', {error: AuthError, stream: true, success: Account}),
			Rpc.make('auth.wait', {error: AuthError, payload: RequestParams, stream: true, success: AuthorizationStatus})
		)
	) {}
