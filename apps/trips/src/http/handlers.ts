import {ByteSize, Effect, Match, Option, String, pipe} from 'effect'
import type {SchemaIssue} from 'effect'

import {HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {BookingSource, BookingsError, IMAGE_BYTES} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'

function ticket(made: Effect.Effect<BookingSource, SchemaIssue.Issue>) {
	return Effect.mapError(made, cause => BookingsError.make({cause, message: 'The ticket is empty or too large.'}))
}

export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const bookings = yield* Bookings
		yield* router.add(
			'POST',
			'/share',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					// The type decides before the body is read, so an unsupported share is refused without buffering it.
					return yield* pipe(
						Match.value(pipe(request.headers['content-type'] ?? '', String.split(';'), parts => String.trim(parts[0]))),
						Match.when('application/pdf', () =>
							Option.some((bytes: Uint8Array) => ticket(BookingSource.cases.pdf.makeEffect({pdf: bytes})))
						),
						Match.when('image/jpeg', () =>
							Option.some((bytes: Uint8Array) => ticket(BookingSource.cases.image.makeEffect({image: bytes})))
						),
						Match.when('application/vnd.apple.pkpass', () =>
							Option.some((bytes: Uint8Array) =>
								Effect.flatMap(bookings.passText(bytes), text => ticket(BookingSource.cases.text.makeEffect({text})))
							)
						),
						Match.when('text/plain', () =>
							Option.some((bytes: Uint8Array) =>
								ticket(BookingSource.cases.text.makeEffect({text: new TextDecoder().decode(bytes)}))
							)
						),
						Match.orElse(() => Option.none()),
						Option.match({
							onNone: () =>
								Effect.succeed(
									HttpServerResponse.text('Share an image, PDF, Wallet pass, text or URL.', {status: 415})
								),
							onSome: source =>
								Effect.gen(function* () {
									const booking = yield* source(new Uint8Array(yield* request.arrayBuffer))
									yield* bookings.save((yield* CurrentUser).id, booking)
									return HttpServerResponse.empty({status: 204})
								})
						})
					)
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
