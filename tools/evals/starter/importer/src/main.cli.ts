import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, Layer, Schema, Stream, pipe} from 'effect'

import {Argument, Command} from 'effect/cli'

import {Importer} from '#service'

NodeRuntime.runMain(
	pipe(
		Command.make(
			'import',
			{file: Argument.String('file')},
			Effect.fnUntraced(function* (input) {
				yield* Console.log(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({imported: Schema.Finite})))({
						imported: (yield* Stream.runCollect((yield* Importer).import(input.file))).length
					})
				)
			})
		),
		Command.run({version: '0.0.0'}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI owns its platform resources.
		Effect.provide(Layer.provideMerge(Importer.layer, NodeServices.layer))
	)
)
