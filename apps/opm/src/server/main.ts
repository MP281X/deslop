import {Layer, Schema, pipe} from 'effect'

import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {ChapterHandlers} from '#server/chapters/rpcs.ts'
import {Chapters} from '#server/chapters/service.ts'
import {PushHandlers} from '#server/push/rpcs.ts'
import {Push} from '#server/push/service.ts'
import icon from '#web/icon.svg'

runApp({
	icon,
	routes: pipe(
		layerRpc({group: RpcContracts, handlers: Layer.merge(ChapterHandlers, PushHandlers)}),
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
