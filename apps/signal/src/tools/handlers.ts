import {Effect} from 'effect'

import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(Tools.of({name: () => Effect.succeed({name: '@deslop/signal'})}))
