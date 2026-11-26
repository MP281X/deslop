import {Effect, Layer} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom} from 'effect/reactivity'
import {Socket} from 'effect/socket'

import {layerWebTelemetry} from './telemetry.ts'

import {readAccount} from '#client/account.ts'
import {layerSocketProtocol} from '#client/protocol.ts'
import {RPC_PATH} from '#shared/schema.ts'

// Without an issuer the account is the developer, who cannot sign out.
export const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(readAccount(''))

export const layerPageProtocol = layerSocketProtocol(
	Layer.provide(
		Socket.layerWebSocket(Effect.sync(() => `${location.origin}${RPC_PATH}`)),
		Socket.layerWebSocketConstructorGlobal
	)
)

// Scope's page skips telemetry so it never traces itself.
export function addPageTelemetry(applicationName: string) {
	Atom.runtime.addGlobalLayer(Layer.provide(layerWebTelemetry(applicationName), FetchHttpClient.layer))
}
