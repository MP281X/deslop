import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Entry, Frame, GameError, HistoryPage, Timeline} from '#services/game/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('signal.history', {
		error: GameError,
		payload: Schema.Struct({actor: Schema.Int, before: Schema.optionalKey(Schema.Int)}),
		success: HistoryPage
	}),
	Rpc.make('signal.join', {error: GameError, stream: true, success: Frame}),
	// The world as it was from a tick on, at a multiple of real time; 0 holds it still.
	Rpc.make('signal.replay', {
		error: GameError,
		payload: Schema.Struct({
			from: Schema.Natural,
			speed: Schema.Int.check(Schema.isBetween({maximum: 60, minimum: 0}))
		}),
		stream: true,
		success: Frame
	}),
	// A team's thread: what its model read, thought and did each round, a page of rounds before `before` or the latest.
	Rpc.make('signal.thread', {
		error: GameError,
		payload: Schema.Struct({before: Schema.optionalKey(Schema.Int), team: Schema.Int}),
		success: Schema.Array(Entry)
	}),
	Rpc.make('signal.timeline', {success: Timeline})
).middleware(RpcAuth) {}
