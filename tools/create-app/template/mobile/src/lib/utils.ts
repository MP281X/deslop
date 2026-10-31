import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import * as MobileRuntime from '@deslop/runtime/mobile'

import {RpcContracts} from '#rpcs/contracts.ts'

// The app's hue from DESIGN.md; pick one no other app uses.
export const primary = hues.orange

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: MobileRuntime.layer('@deslop/template-app')('https://template-app.mp281x.xyz')
}) {}
