import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {AtlasError, Snapshot} from '#services/changes/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('atlas.snapshot', {error: Schema.Union([AuthError, AtlasError]), stream: true, success: Snapshot})
).middleware(RpcAuth) {}
