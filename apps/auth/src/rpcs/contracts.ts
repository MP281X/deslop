import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, User} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {AuthorizationStatus, PendingAuthorization, RequestParams} from '#services/authorizations/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('auth.me', {success: User}),
	Rpc.make('auth.pending', {error: AuthError, stream: true, success: Schema.Array(PendingAuthorization)})
)
	.middleware(RpcAuth)
	.merge(
		RpcGroup.make(
			Rpc.make('auth.wait', {error: AuthError, payload: RequestParams, stream: true, success: AuthorizationStatus})
		)
	) {}
