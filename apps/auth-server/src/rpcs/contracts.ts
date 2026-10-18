import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, User} from '@deslop/auth/schema'
import {RpcAuth} from '@deslop/auth/utils'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('auth.me', {success: User}),
	Rpc.make('auth.createApiKey', {error: AuthError, success: Schema.String})
).middleware(RpcAuth) {}
