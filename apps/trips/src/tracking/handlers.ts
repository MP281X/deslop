import {Effect} from 'effect'

import {TrackingRpcs} from './contract.ts'
import {Tracking} from './server.ts'

export const trackingHandlers = TrackingRpcs.toLayerHandler(
	'tracking.refresh',
	Effect.map(Tracking, service => input => service.refresh(input.id))
)
