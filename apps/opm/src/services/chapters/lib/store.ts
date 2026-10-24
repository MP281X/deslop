import {Array, Context, Effect, Layer, Option, Schema, SynchronizedRef, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import {Chapter, ChaptersError, PushToken} from '#services/chapters/schema.ts'

const failed = Effect.mapError((cause: unknown) => ChaptersError.make({cause, message: 'The chapter storage failed.'}))

export const openStore = Effect.fnUntraced(function* (directory: string) {
	const store = Context.get(yield* Layer.build(layerKeyValueStore(directory)), KeyValueStore.KeyValueStore)
	const chapters = KeyValueStore.toSchemaStore(store, Schema.Array(Chapter))
	const devices = KeyValueStore.toSchemaStore(store, Schema.Array(PushToken))
	const tokens = yield* SynchronizedRef.make(Array.copy(Option.getOrElse(yield* devices.get('devices'), () => [])))
	function updateDevices(update: (current: PushToken[]) => PushToken[]) {
		return pipe(
			SynchronizedRef.updateEffect(tokens, current => {
				const next = update(current)
				return Effect.as(devices.set('devices', next), next)
			}),
			Effect.uninterruptible,
			failed
		)
	}
	return {
		addDevice: (token: PushToken) => updateDevices(current => Array.dedupe([...current, token])),
		devices: SynchronizedRef.get(tokens),
		load: pipe(chapters.get('chapters'), Effect.map(Option.getOrElse(() => [])), failed),
		removeDevice: (token: string) => updateDevices(current => Array.filter(current, saved => saved !== token)),
		save: (current: Chapter[]) => pipe(chapters.set('chapters', current), failed)
	}
}, failed)
