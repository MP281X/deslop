import {Layer, Schema, pipe} from 'effect'

import {RpcSerialization} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerBookings} from '#services/bookings/service.ts'
import {Push, layerApnsClient} from '#services/push/service.ts'
import {Tracker} from '#services/tracking/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(RpcSerialization.layerJson),
		Layer.provide(Layer.mergeAll(Layer.provide(Push.layer, layerApnsClient), Tracker.layer)),
		Layer.provide(layerBookings)
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
