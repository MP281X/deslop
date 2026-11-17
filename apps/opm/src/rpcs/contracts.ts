import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Device} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'

import {ChaptersError, ChaptersEvent, ReadingError, ReadingPosition} from '#services/chapters/schema.ts'
import {Bundle, PushError} from '#services/push/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('chapters.events', {error: ChaptersError, stream: true, success: ChaptersEvent}),
	Rpc.make('chapters.write', {error: ReadingError, payload: ReadingPosition.json}),
	Rpc.make('push.register', {
		error: PushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: Bundle, kind: Schema.Literal('alert')}))
	})
).middleware(RpcAuth) {}
