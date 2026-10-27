import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Action, Frame, GameError, Reply, Steer} from '#services/game/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('signal.join', {
		error: GameError,
		payload: Schema.Struct({invite: Schema.optionalKey(Schema.String)}),
		stream: true,
		success: Frame
	}),
	Rpc.make('signal.steer', {payload: Schema.Struct({...Steer.fields, px: Schema.Finite, pz: Schema.Finite})}),
	Rpc.make('signal.act', {error: GameError, payload: Action, success: Schema.String}),
	// CORE's reply, growing as it streams; drone is the one the signal is on, which "here" refers to.
	Rpc.make('signal.ask', {
		error: GameError,
		payload: Schema.Struct({
			drone: Schema.optionalKey(Schema.Finite),
			text: Schema.NonEmptyString.check(Schema.isMaxLength(400))
		}),
		stream: true,
		success: Reply
	})
).middleware(RpcAuth) {}
