import {NodeDns, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, Layer, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth, HttpAuth} from '@deslop/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
import {Capture, FileType, Note, NoteId} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const noteIdParam = HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))

// The Swift share extension cannot speak the RPC protocol, and SwiftUI images load from a downloaded file.
const routes = pipe(
	HttpRouter.use(router =>
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
				'POST',
				'/api/files/:id',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const type = yield* Schema.decodeUnknownEffect(FileType)(
						pipe(request.headers['content-type'] ?? '', String.split(';'), Array.headNonEmpty, String.trim)
					)
					return yield* HttpServerResponse.schemaJson(Note)(
						yield* notes.captureFile({body: request.stream, id: (yield* noteIdParam).id, type})
					)
				})
			)
			yield* router.add(
				'GET',
				'/api/images/:id',
				Effect.gen(function* () {
					const image = yield* notes.image((yield* noteIdParam).id)
					return HttpServerResponse.uint8Array(image.bytes, {
						contentType: image.type,
						headers: {'cache-control': 'private, max-age=31536000, immutable'}
					})
				})
			)
		})
	),
	Layer.provide(HttpAuth.layer)
)

// Binary frames failed to reopen a cancelled watch.
const rpc = pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(RpcHandlers),
	Layer.provide(RpcSerialization.layerJson)
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(pipe(Layer.merge(rpc, routes), Layer.provide(Auth.layer)), {disableLogger: true}),
		Layer.provide(Notes.layer),
		Layer.provide(Layer.mergeAll(Sources.layer, Media.layer, Organizer.layer)),
		Layer.provide(Layer.mergeAll(NodeDns.layer, NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/stash')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
