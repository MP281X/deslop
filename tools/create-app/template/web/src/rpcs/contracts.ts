import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

export class RpcContracts extends RpcGroup.make(Rpc.make('app.name', {success: Schema.String})) {}
