import {Schema} from 'effect'

import {Rpc, RpcGroup, RpcMiddleware} from 'effect/rpc'

import {AuthError, RpcAuth} from '@deslop/runtime/shared/auth'

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
	Rpc.make('signins.lookup', {
		error: AuthError,
		payload: CodeParams,
		stream: true,
		success: Schema.Option(PendingAuthorization)
	}),
	Rpc.make('signins.answer', {error: AuthError, payload: AnswerParams}),
	Rpc.make('people.watch', {error: AuthError, stream: true, success: Schema.Array(Person)}),
	Rpc.make('people.admit', {error: AuthError, payload: AdmitParams, success: Person}),
	Rpc.make('tokens.watchApps', {error: AuthError, stream: true, success: Schema.Array(SignedInApp)}),
	Rpc.make('apps.watch', {error: AuthError, stream: true, success: Catalog}),
	Rpc.make('passkeys.watch', {error: AuthError, stream: true, success: Schema.Array(Passkey)}),
	Rpc.make('passkeys.registration', {error: AuthError, success: CreationOptions}),
	Rpc.make('passkeys.add', {error: AuthError, payload: AddPasskeyParams})
)
	.middleware(RpcAuth)
	.middleware(RpcOwner)
	.merge(
		// A GitHub account an admin has not allowed yet still reads its own state, and a waiting sign-in has no account at all.
		RpcGroup.make(
			Rpc.make('people.account', {error: AuthError, stream: true, success: SignedAccount}),
			Rpc.make('signins.status', {error: AuthError, payload: RequestParams, stream: true, success: AuthorizationStatus})
		)
	) {}
