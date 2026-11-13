import {Layer, Schema, pipe} from 'effect'

import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Chapters} from '#services/chapters/service.ts'
import {Reading} from '#services/reading/service.ts'

runApp({
	icon,
	routes: pipe(
		layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(Layer.merge(Chapters.layer, Reading.layer)),
		Layer.provide(Layer.provide(Apns.layer, layerApnsClient))
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
