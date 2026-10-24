import {Array, Context, Effect, Layer, Option, Schema, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import {Note, NotesError, TagDefinition} from '#services/notes/schema.ts'

const failed = Effect.mapError((cause: unknown) => NotesError.make({cause, message: 'The note storage failed.'}))

export const openStore = Effect.fnUntraced(function* (directory: string) {
	const store = Context.get(yield* Layer.build(layerKeyValueStore(directory)), KeyValueStore.KeyValueStore)
	const notes = KeyValueStore.toSchemaStore(store, Schema.Array(Note))
	const tags = KeyValueStore.toSchemaStore(store, Schema.Array(TagDefinition))
	return {
		definitions: pipe(tags.get('tags'), Effect.map(Option.getOrElse(() => [])), failed),
		load: pipe(
			notes.get('notes'),
			Effect.map(value => Array.copy(Option.getOrElse(value, () => []))),
			failed
		),
		save: (current: Note[]) => pipe(notes.set('notes', current), failed),
		saveDefinitions: (current: TagDefinition[]) => pipe(tags.set('tags', current), failed)
	}
}, failed)
