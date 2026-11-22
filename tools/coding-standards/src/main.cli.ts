#!/usr/bin/env node

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, FileSystem, Path, Schema, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {judge, layerCache} from '#judge.ts'

import {haiku} from '#lib/model.ts'

// Printed before formatting and lint, for the agent fixing the diagnostics.
const TACTICS = `Fix each diagnostic at the cause its message names:
- No cast, wrapper, spread, suppression or file split just to pass; a documented exception carries its reason.
- Inline in evaluation order; move a declaration used before its definition up, never into a new module.
- Delete a whole unused declaration, never only its header.`

type Manifest = typeof Manifest.Type
const Manifest = Schema.fromJsonString(Schema.Struct({version: Schema.String}))

const command = pipe(
	Command.make('coding-standards'),
	Command.withDescription('Lint tactics and semantic judging'),
	Command.withSubcommands([
		Command.withDescription(
			Command.make('tactics', {}, () => Console.log(TACTICS)),
			'Print lint tactics for diagnostics autofix leaves'
		),
		Command.withDescription(
			Command.make(
				'judge',
				{
					base: pipe(
						Flag.String('base'),
						Flag.withDescription(
							"The branch the change goes into; by default the pull request's base, else origin's default branch"
						),
						Flag.optional
					),
					dryRun: pipe(
						Flag.Boolean('dry-run'),
						Flag.withDescription('Print what would be asked, with its estimated tokens, and send nothing'),
						Flag.withDefault(false)
					),
					userAsked: pipe(
						Flag.Boolean('user-asked'),
						Flag.withDescription(
							'The user explicitly requested this paid run; without it a run that would send a request fails first'
						),
						Flag.withDefault(false)
					)
				},
				// oxlint-disable-next-line effecttsgo/strict-effect-provide -- the judge subcommand is the cache's entry point: only it remembers answers, so only it opens the cache directory.
				input => Effect.provide(judge(input, haiku), layerCache)
			),
			'Ask the functions, components and test cases a change touches the questions no remembered answer covers, and report what breaks one'
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

NodeRuntime.runMain(Effect.provide(cli, [NodeServices.layer, NodeHttpClient.layerNodeHttp, NodeCrypto.layer]))
