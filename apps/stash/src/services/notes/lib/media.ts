import {Array, Boolean, Cache, Duration, Effect, Exit, Function, pipe} from 'effect'

import {Sources} from './extraction.ts'

import {NotesError} from '#services/notes/schema.ts'

// A source that failed is asked again soon.
function lifetime<A, E>(exit: Exit.Exit<A, E>) {
	return Boolean.match(Exit.isSuccess(exit), {
		onFalse: Function.constant(Duration.seconds(10)),
		onTrue: Function.constant(Duration.minutes(5))
	})
}

// The server keeps no pictures on disk: what a post shows is read from its source when a note opens and held in memory for a few minutes, so the phone's requests for its pictures share one read.
export const makeMediaReader = Effect.gen(function* () {
	const sources = yield* Sources
	const lists = yield* Cache.makeWith(sources.photos, {capacity: 32, timeToLive: lifetime})
	// A residential exit is sometimes offline, so a picture gets two more tries, each from another address.
	const images = yield* Cache.makeWith((url: string) => Effect.retry(sources.image(url), {times: 2}), {
		capacity: 16,
		timeToLive: lifetime
	})
	return {
		count: Effect.fnUntraced(function* (link: string) {
			return (yield* Cache.get(lists, link)).length
		}),
		file: Effect.fnUntraced(function* (link: string, index: number) {
			const url = yield* pipe(
				lists,
				Cache.get(link),
				Effect.flatMap(list =>
					pipe(
						Array.get(list, index),
						Effect.fromOption,
						Effect.mapError(() => NotesError.make({message: 'This note has no such picture.'}))
					)
				)
			)
			return yield* Cache.get(images, url)
		})
	}
})
