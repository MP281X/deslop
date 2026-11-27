import {Effect, Option, Queue, Redacted, Schema, Stream, String, pipe} from 'effect'

import type {PluginListenerHandle} from '@capacitor/core'
import {registerPlugin} from '@capacitor/core'
import {AtomRegistry} from 'effect/reactivity'

import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import {nativeBundle} from '@deslop/ui/native'

import type {ChapterIdentity} from '#contracts'
import {ChapterBundle, ChapterNumberFromString, ChapterPushError, Series} from '#contracts'

import {listenNative, registerTokens} from '#web/platform.ts'
import {RpcClient} from '#web/session.ts'

type OpmNativeEvents = {chapterStartToken: {value: string}; chapterOpened: {url: string}}

const native = registerPlugin<{
	addListener: <K extends keyof OpmNativeEvents>(
		event: K,
		listener: (data: OpmNativeEvents[K]) => void
	) => PromiseLike<PluginListenerHandle>
	watchChapterStarts: () => PromiseLike<void>
}>('OpmNative')

type ActivityLink = typeof ActivityLink.Type
const ActivityLink = Schema.TemplateLiteralParser([
	Schema.Literals(['opm', 'opm-dev']),
	'://chapter/',
	Series,
	'/',
	ChapterNumberFromString
])

function listen(message: string, call: () => PromiseLike<PluginListenerHandle>) {
	return listenNative(call, cause => ChapterPushError.make({cause, message}))
}

export const chapterOpens = Stream.catch(
	Stream.callback<ChapterIdentity, ChapterPushError>(queue =>
		listen('Live Activity taps could not be observed.', () =>
			native.addListener('chapterOpened', event => {
				Option.map(Schema.decodeUnknownOption(ActivityLink)(event.url), parts =>
					Queue.offerUnsafe(queue, {number: parts[4], series: parts[2]})
				)
			})
		)
	),
	cause => Stream.fromEffectDrain(Effect.logWarning('Could not open the chapter from the Live Activity', cause))
)

const tokens = Stream.callback<string, ChapterPushError>(queue =>
	Effect.gen(function* () {
		yield* listen('The push-to-start token could not be observed.', () =>
			native.addListener('chapterStartToken', token => {
				Queue.offerUnsafe(queue, token.value)
			})
		)
		yield* Effect.tryPromise({
			catch: cause => ChapterPushError.make({cause, message: 'The push-to-start token could not be read.'}),
			try: () => native.watchChapterStarts()
		})
	})
)

export const registerPush = Stream.catch(
	registerTokens(tokens, value =>
		Effect.gen(function* () {
			const token = yield* Schema.decodeEffect(ApnsToken)(String.toLowerCase(value))
			const bundle = yield* Schema.decodeUnknownEffect(ChapterBundle)(yield* nativeBundle)
			const context = yield* AtomRegistry.getResult(yield* AtomRegistry.AtomRegistry, RpcClient.runtime)
			yield* registerPushToken(
				pipe(
					RpcClient,
					Effect.flatMap(client => client('push.register', {bundle, kind: 'start', token: Redacted.make(token)})),
					Effect.provideContext(context)
				)
			)
		})
	),
	cause => Stream.fromEffectDrain(Effect.logWarning('Live Activities could not be set up on this iPhone', cause))
)
