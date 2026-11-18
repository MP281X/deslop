import {Array, Effect, Match, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {Capture, FileType, NoteId, NotesError} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const noteIdParam = HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))

const mediaParams = HttpRouter.schemaPathParams(
	Schema.Struct({id: NoteId, index: Schema.FiniteFromString.check(Schema.isInt())})
)

// A share the server can never take answers with a 4xx status, which the share extension shows instead of queueing it again; storage failures stay 500, which it retries.
function refusal(error: NotesError) {
	return pipe(
		Match.value(error.reason),
		Match.when('Invalid', () => Effect.succeed(HttpServerResponse.text(error.message, {status: 422}))),
		Match.when('TooLarge', () => Effect.succeed(HttpServerResponse.text(error.message, {status: 413}))),
		Match.when('Removed', () => Effect.succeed(HttpServerResponse.text(error.message, {status: 410}))),
		Match.orElse(() => Effect.fail(error))
	)
}

// The Swift share extension cannot speak the RPC protocol, and SwiftUI images load from a downloaded file.
export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const notes = yield* Notes
		yield* router.add(
			'POST',
			'/api/capture',
			Effect.catchTags(
				Effect.gen(function* () {
					yield* notes.capture((yield* CurrentUser).id, yield* HttpServerRequest.schemaBodyJson(Capture))
					return HttpServerResponse.empty({status: 204})
				}),
				{
					NotesError: refusal,
					SchemaError: () =>
						Effect.succeed(HttpServerResponse.text('The share is not a note Stash can read.', {status: 422}))
				}
			)
		)
		yield* router.add(
			'POST',
			'/api/files/:id',
			Effect.catchTag(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const type = yield* Effect.catchTag(
						Schema.decodeUnknownEffect(FileType)(
							pipe(request.headers['content-type'] ?? '', String.split(';'), Array.headNonEmpty, String.trim)
						),
						'SchemaError',
						() =>
							Effect.fail(
								NotesError.make({message: 'Share a JPEG photo or an MP4 or QuickTime video.', reason: 'Invalid'})
							)
					)
					yield* notes.captureFile((yield* CurrentUser).id, {body: request.stream, id: (yield* noteIdParam).id, type})
					return HttpServerResponse.empty({status: 204})
				}),
				'NotesError',
				refusal
			)
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
		yield* router.add(
			'GET',
			'/api/notes/:id/media/:index',
			Effect.gen(function* () {
				const params = yield* mediaParams
				const file = yield* notes.mediaFile(params.id, params.index)
				return HttpServerResponse.uint8Array(file.bytes, {
					contentType: file.type,
					headers: {'cache-control': 'private, max-age=300'}
				})
			})
		)
	})
)
