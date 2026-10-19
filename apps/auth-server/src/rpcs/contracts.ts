import {Rpc, RpcGroup} from 'effect/rpc'

import {User} from '@deslop/auth/schema'
import {RpcAuth} from '@deslop/auth/utils'

export class RpcContracts extends RpcGroup.make(Rpc.make('auth.me', {success: User})).middleware(RpcAuth) {}
