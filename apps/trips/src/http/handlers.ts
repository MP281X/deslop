import {ByteSize, Effect, Schema, pipe} from 'effect'

import {HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {passText} from '#services/bookings/lib/pkpass/utils.ts'
import {BookingSource, BookingsError, IMAGE_BYTES} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const bookings = yield* Bookings
		yield* router.add(
			'POST',
			'/share',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const type = request.headers['content-type']?.split(';')[0]?.trim()
					const bytes = new Uint8Array(yield* request.arrayBuffer)
					let source: BookingSource
					if (type === 'application/pdf') source = {_tag: 'pdf', pdf: bytes}
					else if (type === 'image/jpeg') source = {_tag: 'image', image: bytes}
					else if (type === 'application/vnd.apple.pkpass') {
						source = {
							_tag: 'text',
							text: yield* Effect.tryPromise({
								catch: cause => BookingsError.make({cause, message: 'The Wallet pass could not be read.'}),
								try: () => passText(bytes)
							})
						}
					} else if (type === 'text/plain') source = {_tag: 'text', text: new TextDecoder().decode(bytes)}
					else return HttpServerResponse.text('Share an image, PDF, Wallet pass, text or URL.', {status: 415})
					yield* Schema.decodeUnknownEffect(BookingSource)(source).pipe(
						Effect.mapError(cause => BookingsError.make({cause, message: 'The ticket is empty or too large.'}))
					)
					yield* bookings.save((yield* CurrentUser).id, source)
					return HttpServerResponse.empty({status: 204})
				}),
				Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(IMAGE_BYTES)),
				Effect.catchTag('HttpServerError', error =>
					Effect.succeed(
						HttpServerResponse.text(
							error.reason._tag === 'RequestParseError' && error.reason.reason === 'BodyTooLarge'
								? 'The ticket is too large.'
								: 'The ticket could not be read.',
							{status: error.reason._tag === 'RequestParseError' && error.reason.reason === 'BodyTooLarge' ? 413 : 400}
						)
					)
				),
				Effect.catchTag('BookingsError', error => Effect.succeed(HttpServerResponse.text(error.message, {status: 422}))),
				Effect.withSpan('Trips.share')
			)
		)
	})
)
