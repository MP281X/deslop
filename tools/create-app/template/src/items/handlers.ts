import {Effect} from 'effect'

import {ItemsRpcs} from './contract.ts'
import {Items} from './server.ts'

export const itemsHandlers = ItemsRpcs.toLayer(
	Effect.map(Items, items => ItemsRpcs.of({'items.watch': () => items.watch}))
)
