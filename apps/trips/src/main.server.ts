import {ByteSize, Layer, Schema, pipe} from 'effect'

import {AiGateway} from '@deslop/runtime/server/ai'
import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {HttpAuth} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerBookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'
import {layerTracking} from '#services/tracking/service.ts'

runApp({
	icon,
	// A pasted ticket travels in one frame: up to 4 MB of image, plus framing.
	maxFrameSize: ByteSize.mebibytes(5),
	routes: pipe(
		Layer.mergeAll(layerRpc({group: RpcContracts, handlers: RpcHandlers}), Layer.provide(HttpHandlers, HttpAuth.layer)),
		Layer.provide(Layer.mergeAll(Layer.provide(Push.layer, Layer.provide(Apns.layer, layerApnsClient)), layerTracking)),
		Layer.provide(layerBookings),
		Layer.provide(AiGateway.layer)
	),
	settings: {
		APNS_KEY_ID: {description: "The APNs signing key's id", flag: 'apns-key-id', schema: Schema.NonEmptyString},
		APNS_TEAM_ID: {
			description: 'The Apple team that owns the APNs key',
			flag: 'apns-team-id',
			schema: Schema.NonEmptyString
		}
	}
})
