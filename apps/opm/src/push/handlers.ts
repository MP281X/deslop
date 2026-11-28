import {Effect} from 'effect'

import {PushRpcs} from './contract.ts'
import {Push} from './server.ts'

export const pushHandlers = PushRpcs.toLayer(Effect.map(Push, push => ({'push.register': push.register})))
