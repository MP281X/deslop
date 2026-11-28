import {ByteSize, Layer, Schema, pipe} from 'effect'

import {AiGateway} from '@deslop/runtime/server/ai'
import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {HttpAuth} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {Activities} from '#activities/server.ts'
import {flightsHandlers, flightsHttp} from '#flights/handlers.ts'
import {Extractor, Flights, Places} from '#flights/server.ts'
import {pushHandlers} from '#push/handlers.ts'
import {Push} from '#push/server.ts'
import {Rounds} from '#rounds/server.ts'
import {trackingHandlers} from '#tracking/handlers.ts'
import {FlightAware, Tracking} from '#tracking/server.ts'
import icon from '#web/icon.svg'

runApp({
	icon,
	// A pasted ticket travels in one frame: up to 4 MB of image, plus framing.
	maxFrameSize: ByteSize.mebibytes(5),
	routes: pipe(
		Layer.mergeAll(
			layerRpc({group: RpcContracts, handlers: Layer.mergeAll(flightsHandlers, pushHandlers, trackingHandlers)}),
			Layer.provide(flightsHttp, HttpAuth.layer)
		),
		Layer.provide(
			Layer.mergeAll(
				Layer.provideMerge(Rounds.layer, Layer.provideMerge(Activities.layer, Push.layer)),
				Layer.provide(Tracking.layer, FlightAware.layer)
			)
		),
		Layer.provide(Layer.provide(Flights.layer, Layer.mergeAll(Places.layer, Extractor.layer))),
		Layer.provide(Layer.provide(Apns.layer, layerApnsClient)),
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
