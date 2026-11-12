import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, Option, Schema, Stream, pipe} from 'effect'

import {HttpRouter} from 'effect/http'

import {Reactivity} from 'effect/reactivity'

import {Auth, HttpAuth} from '@deslop/runtime/server/auth'

import {HttpHandlers} from '#http/handlers.ts'
import {Media} from '#services/media/service.ts'
// oxlint-disable-next-line no-restricted-imports -- The handlers run over real notes, with stand-ins for the page reader and the AI that Notes keeps private.
import {Sources} from '#services/notes/lib/extraction.ts'
// oxlint-disable-next-line no-restricted-imports -- As above: the AI organizer is Notes' own internal.
import {Organizer} from '#services/notes/lib/organization.ts'
import {NoteId} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const USER = {id: 'github:1', name: 'tester'}
const ID = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01')

const organizer = Organizer.of({
	organize: () =>
		Effect.succeed({
			body: '',
			definitions: [],
			screenText: '',
			summary: '',
			tags: ['reading'],
			title: 'Saved',
			topics: ''
		})
})

const sources = Sources.of({
	extract: () => Effect.die('A note without a link reads no page'),
	image: () => Effect.die('A note without a page keeps no image'),
	resolve: Effect.succeed
})

const media = Media.of({
	fileFrames: () => Effect.die('No video was uploaded'),
	fileTranscript: () => Effect.die('No video was uploaded'),
	frames: () => Effect.die('No video was uploaded'),
	read: () => Effect.die('No video was uploaded')
})

const auth = Layer.succeedContext(
	Auth.makeContext(Auth.of({token: () => Effect.succeed('token'), user: () => Effect.succeed(USER)}))
)

const serve = Effect.fnUntraced(function* () {
	const notes = Context.get(
		yield* Layer.build(
			pipe(
				Notes.layer(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()),
				Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
				Layer.provide(Layer.succeed(Sources, sources)),
				Layer.provide(Layer.succeed(Media, media)),
				Layer.provide(Layer.succeed(Organizer, organizer))
			)
		),
		Notes
	)
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					HttpHandlers,
					Layer.provide(Layer.succeed(Notes, notes)),
					Layer.provide(HttpAuth.layer),
					Layer.provide(auth)
				),
				{disableLogger: true}
			)
		),
		handler => Effect.promise(() => handler.dispose())
	)
	return {notes, web}
})

function send(web: Effect.Success<ReturnType<typeof serve>>['web'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, 'https://stash.mp281x.xyz'), init)))
}

// The note once the list shows it ready.
const ready = Effect.fnUntraced(function* (notes: typeof Notes.Service, id: NoteId) {
	yield* pipe(
		notes.events,
		Stream.filter(event => Array.some(event.upserted, item => item.id === id && item.status === 'ready')),
		Stream.runHead
	)
	return yield* notes.get(id)
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))('Stash HTTP routes', test => {
	test.effect('stores a capture for the signed-in user before answering 204', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const server = yield* serve()
				const text = 'Remember to read the new article'
				const response = yield* send(server.web, '/api/capture', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({id: ID, text}),
					headers: {'content-type': 'application/json'},
					method: 'POST'
				})
				assert.strictEqual(response.status, 204)
				assert.containsSubset(yield* ready(server.notes, ID), {id: ID, requester: USER.id, status: 'ready', text})
			})
		)
	)

	test.effect('accepts a photo by its content type and serves it with its immutable cache header', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const server = yield* serve()
				const photo = new Uint8Array([255, 216, 255, 224])
				const uploaded = yield* send(server.web, `/api/files/${ID}`, {
					body: photo,
					headers: {'content-type': 'image/jpeg; charset=binary'},
					method: 'POST'
				})
				assert.strictEqual(uploaded.status, 204)
				assert.deepStrictEqual(yield* server.notes.image(ID), {bytes: photo, type: 'image/jpeg'})
				const image = yield* send(server.web, `/api/images/${ID}`)
				assert.strictEqual(image.status, 200)
				assert.strictEqual(image.headers.get('content-type'), 'image/jpeg')
				assert.strictEqual(image.headers.get('cache-control'), 'private, max-age=31536000, immutable')
				assert.deepStrictEqual(new Uint8Array(yield* Effect.promise(() => image.arrayBuffer())), photo)
				const refused = yield* send(server.web, '/api/files/6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02', {
					body: 'not a photo',
					headers: {'content-type': 'text/plain'},
					method: 'POST'
				})
				assert.strictEqual(refused.status, 400)
				assert.strictEqual((yield* server.notes.list({cursor: Option.none(), limit: 10, query: ''})).total, 1)
			})
		)
	)
})
