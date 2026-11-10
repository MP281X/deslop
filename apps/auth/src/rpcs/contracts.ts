import {Schema} from 'effect'

import {Rpc, RpcGroup, RpcMiddleware} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Catalog} from '#services/apps/schema.ts'
import {AddPasskeyParams, CreationOptions, Passkey} from '#services/passkeys/schema.ts'
import {AdmitParams, Person, SignedAccount} from '#services/people/schema.ts'
import {
	AnswerParams,
	AuthorizationStatus,
	CodeParams,
	PendingAuthorization,
	RequestParams
} from '#services/sign-ins/schema.ts'
import type {CurrentOwner} from '#services/tokens/schema.ts'
import {SignedInApp} from '#services/tokens/schema.ts'

export class RpcOwner extends RpcMiddleware.Service<RpcOwner, {provides: CurrentOwner}>()(
	'@deslop/auth/rpcs/RpcOwner',
	{error: AuthError}
) {}

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
	Rpc.make('auth.apps', {error: AuthError, stream: true, success: Schema.Array(SignedInApp)}),
	Rpc.make('auth.catalog', {error: AuthError, stream: true, success: Catalog}),
	Rpc.make('auth.passkeys', {error: AuthError, stream: true, success: Schema.Array(Passkey)}),
	Rpc.make('auth.passkeyOptions', {error: AuthError, success: CreationOptions}),
	Rpc.make('auth.addPasskey', {error: AuthError, payload: AddPasskeyParams})
)
	.middleware(RpcAuth)
	.middleware(RpcOwner)
	.merge(
		// A GitHub account an admin has not allowed yet still reads its own state, and a waiting sign-in has no account at all.
		RpcGroup.make(
			Rpc.make('auth.account', {error: AuthError, stream: true, success: SignedAccount}),
			Rpc.make('auth.wait', {error: AuthError, payload: RequestParams, stream: true, success: AuthorizationStatus})
		)
	) {}
