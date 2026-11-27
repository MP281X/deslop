import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {RpcHandlers} from '#server/app/rpcs.ts'
import icon from '#web/icon.svg'

runApp({icon, routes: layerRpc({group: RpcContracts, handlers: RpcHandlers})})
