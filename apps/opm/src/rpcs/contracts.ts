import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/shared/auth'

import {ChaptersError, Device} from '#services/chapters/schema.ts'
import {ChaptersEvent, ReadingError, ReadingPosition} from '#services/reading/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('chapters.events', {error: ChaptersError, stream: true, success: ChaptersEvent}),
	Rpc.make('reading.write', {error: ReadingError, payload: ReadingPosition.json}),
	Rpc.make('chapters.register', {error: ChaptersError, payload: Device.insert})
).middleware(RpcAuth) {}
