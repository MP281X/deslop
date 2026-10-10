import {NodeHttpClient, NodeServices} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/internal/extraction.ts'
import {Organizer} from '#services/notes/internal/organization.ts'
import {Capture, Note, NoteId} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

// The share extension is plain Swift, so it saves through one JSON route instead of the RPC protocol.
// The app loads preview images over plain HTTP, because SwiftUI images need a file it downloads first.
const routes = HttpRouter.use(router =>
	Effect.gen(function* () {
		const notes = yield* Notes
		yield* router.add(
			'POST',
			'/api/capture',
			Effect.gen(function* () {
				return yield* HttpServerResponse.schemaJson(Note)(
					yield* notes.capture(yield* HttpServerRequest.schemaBodyJson(Capture))
				)
			})
		)
		yield* router.add(
			'GET',
			'/api/images/:id',
			Effect.gen(function* () {
				const image = yield* notes.image((yield* HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))).id)
				return HttpServerResponse.uint8Array(image.bytes, {
					contentType: image.type,
					headers: {'cache-control': 'private, max-age=31536000, immutable'}
				})
			})
		)
	})
)

// JSON frames, because binary frames failed to reopen a cancelled watch in the earlier web version.
const rpc = pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(RpcHandlers),
	Layer.provide(RpcSerialization.layerJson)
)

export default pipe(
	Layer.merge(rpc, routes),
	Layer.provide(Notes.layer),
	Layer.provide(Layer.mergeAll(pipe(Sources.layer, Layer.provide(Media.layer)), Organizer.layer)),
	Layer.provide(Layer.merge(NodeHttpClient.layerFetch, NodeServices.layer))
)
