import {Array, Effect, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {Capture, FileType, NoteId} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const noteIdParam = HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))

// The Swift share extension cannot speak the RPC protocol, and SwiftUI images load from a downloaded file.
export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const notes = yield* Notes
		yield* router.add(
			'POST',
			'/api/capture',
			Effect.gen(function* () {
				yield* notes.capture((yield* CurrentUser).id, yield* HttpServerRequest.schemaBodyJson(Capture))
				return HttpServerResponse.empty({status: 204})
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
				yield* notes.captureFile((yield* CurrentUser).id, {body: request.stream, id: (yield* noteIdParam).id, type})
				return HttpServerResponse.empty({status: 204})
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
