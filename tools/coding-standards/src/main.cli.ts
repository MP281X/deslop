#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, FileSystem, Path, Schema, pipe} from 'effect'

import {Command} from 'effect/cli'

// Printed before formatting and lint, for the agent fixing the diagnostics.
const TACTICS = `Fix each diagnostic at the cause its message names:
- No cast, wrapper, spread, suppression or file split just to pass; a documented exception carries its reason.
- Inline in evaluation order; move a declaration used before its definition up, never into a new module.
- Delete a whole unused declaration, never only its header.`

type Manifest = typeof Manifest.Type
const Manifest = Schema.fromJsonString(Schema.Struct({version: Schema.String}))

const command = pipe(
	Command.make('coding-standards'),
	Command.withDescription('Lint tactics'),
	Command.withSubcommands([
		Command.withDescription(
			Command.make('tactics', {}, () => Console.log(TACTICS)),
			'Print lint tactics for diagnostics autofix leaves'
		)
	])
)

// The release bumps the packed manifest after the build, so the version is read from the manifest beside the running file, in source and in dist alike.
const cli = Effect.gen(function* () {
	const manifest = yield* Schema.decodeEffect(Manifest)(
		yield* (yield* FileSystem.FileSystem).readFileString(
			yield* (yield* Path.Path).fromFileUrl(new URL('../package.json', import.meta.url))
		)
	)
	return yield* Command.run(command, {version: manifest.version})
})

NodeRuntime.runMain(Effect.provide(cli, NodeServices.layer))
