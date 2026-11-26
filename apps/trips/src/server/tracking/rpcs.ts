import {Effect} from 'effect'

import {TrackingRpcs} from '#contracts'

import {Tracking} from './service.ts'

export const trackingHandlers = TrackingRpcs.toLayerHandler(
	'tracking.refresh',
	Effect.map(Tracking, service => input => service.refresh(input.id))
)
