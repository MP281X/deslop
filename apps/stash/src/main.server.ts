import {NodeDns, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth, HttpAuth} from '@deslop/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

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

// Cookie-authenticated browsers must use the server's own origin.
const sameOrigin = HttpMiddleware.make(app =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		// The app's socket sends the server's own origin; agents and the share extension send none.
		const origin = Option.fromNullishOr(request.headers['origin'])
		const own = Option.exists(
			Option.flatMap(origin, value => Option.liftThrowable(() => new URL(value).host)()),
			value => value === request.headers['host']
		)
		if (Option.isSome(origin) && !own) {
			return HttpServerResponse.empty({status: 403})
		}
		return yield* app
	})
)

// Binary frames failed to reopen a cancelled watch.
const rpc = pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(RpcHandlers),
	Layer.provide(RpcSerialization.layerJson)
)

const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions:
				'Stash keeps links and notes the user saved: it reads each link, transcribes its video and tags it. Search or list notes, read one whole with get, and save a link or text with save.',
			name: 'stash',
			version: packageJson.version
		})
	)
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(Layer.mergeAll(rpc, pipe(routes, Layer.provide(HttpAuth.layer)), mcp), {
			disableLogger: true,
			middleware: sameOrigin
		}),
		Layer.provide(Auth.layer('https://stash.mp281x.xyz')),
		Layer.provide(layerNotes),
		Layer.provide(Layer.mergeAll(Sources.layer, Media.layer, Organizer.layer)),
		Layer.provide(Layer.mergeAll(NodeDns.layer, NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/stash')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
