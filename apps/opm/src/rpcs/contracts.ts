import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {ChaptersError, ChaptersEvent, PushToken, ReadingUpdate} from '#services/chapters/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('library.watch', {stream: true, success: ChaptersEvent}),
	Rpc.make('chapters.read', {error: ChaptersError, payload: ReadingUpdate}),
	Rpc.make('devices.register', {error: ChaptersError, payload: Schema.Struct({token: PushToken})})
).middleware(RpcAuth) {}
