import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/shared/auth'

export class RpcContracts extends RpcGroup.make(Rpc.make('app.name', {success: Schema.String})).middleware(RpcAuth) {}
