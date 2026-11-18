import {Rpc, RpcGroup} from 'effect/rpc'

import {JoinVisitor, MoveVisitor, PresenceError, RecolorVisitor, Scene} from '#services/presence/schema.ts'

// Visitors are guests, so the room needs no sign-in; a guest key, not the caller, decides whose cursor a socket moves.
export class RpcContracts extends RpcGroup.make(
	Rpc.make('presence.join', {error: PresenceError, payload: JoinVisitor, stream: true, success: Scene}),
	Rpc.make('presence.move', {error: PresenceError, payload: MoveVisitor}),
	Rpc.make('presence.recolor', {error: PresenceError, payload: RecolorVisitor})
) {}
