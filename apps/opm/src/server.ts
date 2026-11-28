import {Layer, Schema, pipe} from 'effect'

import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {chaptersHandlers} from '#chapters/handlers.ts'
import {Chapters} from '#chapters/server.ts'
import {pushHandlers} from '#push/handlers.ts'
import {Push} from '#push/server.ts'
import icon from '#web/icon.svg'

runApp({
	icon,
	routes: pipe(
		layerRpc({group: RpcContracts, handlers: Layer.merge(chaptersHandlers, pushHandlers)}),
		Layer.provide(Layer.provideMerge(Chapters.layer, Push.layer)),
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
