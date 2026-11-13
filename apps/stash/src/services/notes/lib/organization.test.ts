import {assert, it} from '@effect/vitest'

import {Context, DateTime, Effect, Function, Layer, Option, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {AiGateway, AiUnavailableError} from '@deslop/runtime/server/ai'
import {UserId} from '@deslop/runtime/shared/auth'

import {Organizer} from './organization.ts'

import {Note, NoteId} from '#services/notes/schema.ts'

const NOTE = Note.make({
	author: Option.none(),
	body: Option.none(),
	content: '',
	createdAt: DateTime.makeUnsafe(0),
	file: Option.none(),
	id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01'),
	image: Option.none(),
	issue: Option.none(),
	requester: UserId.make('github:1'),
	screenText: Option.none(),
	source: 'Note',
	status: 'organizing',
	summary: '',
	text: 'Remember the lentils',
	title: 'Lentils',
	topics: Option.none(),
	transcript: Option.none(),
	url: Option.none()
})

function open(gateway: AiGateway['Service'], client: HttpClient.HttpClient) {
	return Effect.map(
		Layer.build(
			pipe(
				Organizer.layer,
				Layer.provide(Layer.succeed(AiGateway, gateway)),
				Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
			)
		),
		context => Context.get(context, Organizer)
	)
}

it.effect(
	'names the missing provider key that the gateway reports',
	Effect.fnUntraced(function* () {
		const gateway = AiGateway.of({
			apiUrl: () => Effect.succeed('https://gateway.mp281x.xyz/ai/anthropic'),
			authorize: () => Effect.succeed(Function.identity)
		})
		const client = HttpClient.make(request =>
			Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					Response.json({error: {message: 'Add an Anthropic key in Gateway'}}, {status: 402})
				)
			)
		)
		const error = yield* Effect.flip(
			(yield* open(gateway, client)).organize(NOTE.requester, {images: [], note: NOTE, tags: []})
		)
		// oxlint-disable-next-line @deslop/coding-standards/no-error-message-assertion -- The gateway's instruction must reach the note unchanged.
		assert.strictEqual(error.message, 'Add an Anthropic key in Gateway')
	})
)

it.effect(
	'names the missing gateway when the app was started without one',
	Effect.fnUntraced(function* () {
		const gateway = AiGateway.of({
			apiUrl: () => Effect.fail(AiUnavailableError.make({message: 'Start the app with --gateway'})),
			authorize: () => Effect.succeed(Function.identity)
		})
		const error = yield* Effect.flip(
			(yield* open(
				gateway,
				HttpClient.make(() => Effect.die('No gateway, no request'))
			)).organize(NOTE.requester, {images: [], note: NOTE, tags: []})
		)
		// oxlint-disable-next-line @deslop/coding-standards/no-error-message-assertion -- The runtime's instruction must reach the note unchanged.
		assert.strictEqual(error.message, 'Start the app with --gateway')
	})
)
