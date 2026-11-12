import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/shared/auth'

import {ChaptersError, ChaptersEvent, Device, ReadingUpdate} from '#services/chapters/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('chapters.events', {error: ChaptersError, stream: true, success: ChaptersEvent}),
	Rpc.make('chapters.read', {error: ChaptersError, payload: ReadingUpdate}),
	Rpc.make('chapters.register', {error: ChaptersError, payload: Device.insert})
).middleware(RpcAuth) {}
