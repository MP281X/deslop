import {ByteSize, Layer, Schema, pipe} from 'effect'

import {AiGateway} from '@deslop/runtime/server/ai'
import {Apns, layerApnsClient} from '@deslop/runtime/server/apns'
import {HttpAuth} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {TripsRpcs} from '#contracts'

import {Extractor} from '#server/flights/extraction.ts'
import {HttpHandlers} from '#server/flights/http.ts'
import {Places} from '#server/flights/places.ts'
import {flightHandlers} from '#server/flights/rpcs.ts'
import {Flights} from '#server/flights/service.ts'
import {pushHandlers} from '#server/push/rpcs.ts'
import {Push} from '#server/push/service.ts'
import {FlightAware} from '#server/tracking/flightaware.ts'
import {trackingHandlers} from '#server/tracking/rpcs.ts'
import {Tracking} from '#server/tracking/service.ts'
import icon from '#web/icon.svg'

runApp({
	icon,
	// A pasted ticket travels in one frame: up to 4 MB of image, plus framing.
	maxFrameSize: ByteSize.mebibytes(5),
	routes: pipe(
		Layer.mergeAll(
			layerRpc({group: TripsRpcs, handlers: Layer.mergeAll(flightHandlers, pushHandlers, trackingHandlers)}),
			Layer.provide(HttpHandlers, HttpAuth.layer)
		),
		Layer.provide(
			Layer.mergeAll(
				Layer.provide(Push.layer, Layer.provide(Apns.layer, layerApnsClient)),
				Layer.provide(Tracking.layer, FlightAware.layer)
			)
		),
		Layer.provide(Layer.provide(Flights.layer, Layer.mergeAll(Places.layer, Extractor.layer))),
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
