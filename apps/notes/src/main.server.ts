import {NodeHttpClient, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Access} from '#rpcs/access.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Telemetry} from '#rpcs/telemetry.ts'
import {Sources} from '#services/notes/internal/extraction.ts'
import {Organizer} from '#services/notes/internal/organization.ts'
import {Notes} from '#services/notes/service.ts'

const notes = pipe(
	Notes.layer,
	Layer.provide(Sources.layer),
	Layer.provide(Organizer.layer),
	Layer.provide(NodeHttpClient.layerFetch),
	Layer.provide(NodeServices.layer)
)

const rpc = pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(RpcSerialization.layerJson),
	Layer.provide(Access),
	Layer.provide(RpcHandlers),
	Layer.provide(notes),
	Layer.provide(NodeServices.layer)
)

export default Layer.merge(rpc, Telemetry)
