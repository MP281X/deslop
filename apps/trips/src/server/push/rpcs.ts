import {Effect} from 'effect'

import {PushRpcs} from '#contracts'

import {Push} from './service.ts'

export const pushHandlers = PushRpcs.toLayerHandler(
	'push.register',
	Effect.map(Push, service => input => service.register(input))
)
