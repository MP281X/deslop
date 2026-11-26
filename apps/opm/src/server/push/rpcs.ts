import {Effect} from 'effect'

import {PushRpcs} from '#contracts'

import {Push} from '#server/push/service.ts'

export const PushHandlers = PushRpcs.toLayer(Effect.map(Push, push => ({'push.register': push.register})))
