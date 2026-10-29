import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Frame, GameError, Reply} from '#services/game/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('signal.join', {error: GameError, stream: true, success: Frame}),
	// CORE's reply, growing as it streams.
	Rpc.make('signal.ask', {
		error: GameError,
		payload: Schema.Struct({text: Schema.NonEmptyString.check(Schema.isMaxLength(400))}),
		stream: true,
		success: Reply
	})
).middleware(RpcAuth) {}
