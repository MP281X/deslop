import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, Option, Stream, pipe} from 'effect'

import {HttpClient} from 'effect/http'
import {TestClock} from 'effect/testing'

import {openStore} from '#services/chapters/lib/store.ts'
import {resumeOf} from '#services/chapters/lib/utils.ts'
import {Chapter} from '#services/chapters/schema.ts'
import {Chapters} from '#services/chapters/service.ts'

it.layer(NodeServices.layer)(test => {
	test.effect('persists shared reading and concurrent device changes without treating list marks as visits', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const first = 'ExpoPushToken[device00000001]'
			const second = 'ExpoPushToken[device00000002]'
			yield* Effect.scoped(
				Effect.gen(function* () {
					const store = yield* openStore(directory)
					yield* store.save(
						Array.map([1, 2], number =>
							Chapter.make({
								notified: true,
								number,
								pages: ['https://example.test/page.png'],
								postedAt: 0,
								source: '',
								title: ''
							})
						)
					)
					yield* store.addDevice(first)
					yield* Effect.all([store.removeDevice(first), store.addDevice(second)], {concurrency: 'unbounded'})
					const chapters = Context.get(
						yield* Layer.build(
							pipe(
								Chapters.layer(directory),
								Layer.provide(
									Layer.succeed(
										HttpClient.HttpClient,
										HttpClient.make(() => Effect.never)
									)
								)
							)
						),
						Chapters
					)
					yield* chapters.read({done: true, number: 2, opened: false, page: 0})
					assert.deepStrictEqual(
						resumeOf((yield* Effect.fromOption(yield* Stream.runHead(chapters.changes))).upserted),
						Option.none()
					)
					yield* TestClock.adjust('1 second')
					yield* chapters.read({done: true, number: 1, opened: true, page: 0})
					yield* chapters.read({done: false, number: 2, opened: false, page: 0})
				})
			)
			const store = yield* openStore(directory)
			assert.deepStrictEqual(resumeOf(yield* store.load), Option.some({number: 1, page: 0}))
			assert.deepStrictEqual(yield* store.devices, [second])
		})
	)
})
