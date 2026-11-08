import {assert, it} from '@effect/vitest'

import {Context, Effect, Layer, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {AiGateway, AiUnavailable} from '@deslop/runtime/ai'

import {Organizer} from '#services/notes/lib/organization.ts'
import {Note} from '#services/notes/schema.ts'

const NOTE = Note.make({
	content: '',
	createdAt: 0,
	id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
	source: 'Note',
	status: 'organizing',
	summary: '',
	tags: [],
	text: 'Remember the lentils',
	title: 'Lentils'
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
			authorize: () => client => client,
			enroll: () => Effect.void
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
			(yield* open(gateway, client)).organize('github:1', {images: [], note: NOTE, tags: []})
		)
		// oxlint-disable-next-line @deslop/coding-standards/no-error-message-assertion -- the gateway's own instruction is what must reach the note
		assert.strictEqual(error.message, 'Add an Anthropic key in Gateway')
	})
)

it.effect(
	'names the missing gateway when the app was started without one',
	Effect.fnUntraced(function* () {
		const gateway = AiGateway.of({
			apiUrl: () => Effect.fail(AiUnavailable.make({message: 'Start the app with --gateway'})),
			authorize: () => client => client,
			enroll: () => Effect.void
		})
		const error = yield* Effect.flip(
			(yield* open(
				gateway,
				HttpClient.make(() => Effect.die('No gateway, no request'))
			)).organize('github:1', {images: [], note: NOTE, tags: []})
		)
		// oxlint-disable-next-line @deslop/coding-standards/no-error-message-assertion -- the runtime's instruction is what must reach the note
		assert.strictEqual(error.message, 'Start the app with --gateway')
	})
)
