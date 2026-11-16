import {ByteSize, Effect, Match, Option, String, pipe} from 'effect'

import {HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/shared/auth'

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
					const type = pipe(request.headers['content-type'] ?? '', String.split(';'), parts => String.trim(parts[0]))
					const bytes = new Uint8Array(yield* request.arrayBuffer)
					const text = yield* pipe(
						Match.value(type),
						Match.when('application/vnd.apple.pkpass', () => bookings.passText(bytes)),
						Match.orElse(() => Effect.succeed(''))
					)
					const source = yield* Effect.try({
						catch: cause => BookingsError.make({cause, message: 'The ticket is empty or too large.'}),
						try: () =>
							pipe(
								Match.value(type),
								Match.when('application/pdf', () => Option.some(BookingSource.cases.pdf.make({pdf: bytes}))),
								Match.when('image/jpeg', () => Option.some(BookingSource.cases.image.make({image: bytes}))),
								Match.when('application/vnd.apple.pkpass', () => Option.some(BookingSource.cases.text.make({text}))),
								Match.when('text/plain', () =>
									Option.some(BookingSource.cases.text.make({text: new TextDecoder().decode(bytes)}))
								),
								Match.orElse(() => Option.none())
							)
					})
					return yield* Option.match(source, {
						onNone: () =>
							Effect.succeed(HttpServerResponse.text('Share an image, PDF, Wallet pass, text or URL.', {status: 415})),
						onSome: booking =>
							Effect.gen(function* () {
								yield* bookings.save((yield* CurrentUser).id, booking)
								return HttpServerResponse.empty({status: 204})
							})
					})
				}),
				Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(IMAGE_BYTES)),
				Effect.catchTags({
					BookingsError: error => Effect.succeed(HttpServerResponse.text(error.message, {status: 422})),
					HttpServerError: error =>
						Effect.succeed(
							pipe(
								Match.value(error.reason),
								Match.when({reason: 'BodyTooLarge'}, () =>
									HttpServerResponse.text('The ticket is too large.', {status: 413})
								),
								Match.orElse(() => HttpServerResponse.text('The ticket could not be read.', {status: 400}))
							)
						)
				}),
				Effect.withSpan('Trips.share')
			)
		)
	})
)
