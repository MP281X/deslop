import {Effect, Layer} from 'effect'

import {RpcMiddleware, RpcSchema} from 'effect/rpc'

// One tag marks every subscription's spans on both ends, so Scope never reads a stream as a failed call.
export class RpcStream extends RpcMiddleware.Service<RpcStream>()('@deslop/runtime/shared/rpc/RpcStream') {}

export const layerRpcStream = Layer.succeed(
	RpcStream,
	RpcStream.of((effect, options) => {
		if (!RpcSchema.isStreamSchema(options.rpc.successSchema)) return effect
		return Effect.andThen(Effect.annotateCurrentSpan('rpc.stream', true), effect)
	})
)

export const layerRpcStreamClient = RpcMiddleware.layerClient(RpcStream, options =>
	Effect.gen(function* () {
		if (RpcSchema.isStreamSchema(options.rpc.successSchema)) {
			yield* Effect.annotateCurrentSpan('rpc.stream', true)
		}
		return yield* options.next(options.request)
	})
)
