import {Layer} from 'effect'

import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {itemsHandlers} from '#items/handlers.ts'
import {Items} from '#items/server.ts'
import icon from '#web/icon.svg'

runApp({icon, routes: Layer.provide(layerRpc({group: RpcContracts, handlers: itemsHandlers}), Items.layer)})
