import {NodeDns} from '@effect/platform-node'

import {Array, Effect, Layer, Schema, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcSerialization} from 'effect/rpc'

import {HttpAuth} from '@deslop/runtime/auth/service'
import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
import {Capture, FileType, Note, NoteId} from '#services/notes/schema.ts'
import {Notes, layerNotes} from '#services/notes/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const noteIdParam = HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))

// The Swift share extension cannot speak the RPC protocol, and SwiftUI images load from a downloaded file.
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
)

// Binary frames failed to reopen a cancelled watch.
const rpc = pipe(
	ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
	Layer.provide(RpcSerialization.layerJson)
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			rpc,
			pipe(routes, Layer.provide(HttpAuth.layer)),
			ServerRuntime.layerMcp({
				instructions: 'Stash is the reading list of articles, videos and posts the user saved or asks to keep.',
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(layerNotes),
		Layer.provide(ServerRuntime.layerDataStore),
		Layer.provide(Layer.mergeAll(Sources.layer, Media.layer, Organizer.layer)),
		Layer.provide(ServerRuntime.ToolPath.layer),
		Layer.provide(NodeDns.layer)
	)
})
