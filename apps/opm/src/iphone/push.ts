import {Effect, Queue, Stream, pipe} from 'effect'

import type {NativeModule} from 'expo'
import {requireNativeModule} from 'expo'

import {ChapterPushError} from '#contracts'

import {variant} from '#iphone/origin.ts'
import type {catalogue} from '#screens/catalogue.ts'

declare class ChapterActivities extends NativeModule<{chapterStartToken: (event: {readonly value: string}) => void}> {
	opened(url: string): PromiseLike<void>
}

const activity = requireNativeModule<ChapterActivities>('ChapterActivities')

export function readChapterActivity(url: string) {
	return Effect.ignore(
		Effect.tryPromise({
			catch: cause => ChapterPushError.make({cause, message: 'The chapter Live Activity could not be dismissed.'}),
			try: () => activity.opened(url)
		}),
		{log: 'Warn'}
	)
}

const tokens = Stream.callback<string>(queue =>
	Effect.acquireRelease(
		Effect.sync(() =>
			activity.addListener('chapterStartToken', token => {
				Queue.offerUnsafe(queue, token.value)
			})
		),
		listener => Effect.sync(() => listener.remove())
	)
)

export function registerChapters(queries: ReturnType<typeof catalogue>) {
	return pipe(
		Stream.changes(tokens),
		Stream.switchMap(value => Stream.fromEffectDrain(queries.registerToken(value, variant.bundle))),
		Stream.catch(cause =>
			Stream.fromEffectDrain(Effect.logWarning('Live Activities could not be set up on this iPhone', cause))
		)
	)
}
