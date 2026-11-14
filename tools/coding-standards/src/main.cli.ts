#!/usr/bin/env node

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, Layer, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {judge, layerCache} from '#judge.ts'
import packageJson from '#package.json' with {type: 'json'}

import {haiku} from '#lib/model.ts'
import {signIn} from '#lib/session.ts'

// Printed before formatting and lint, for the agent fixing the diagnostics.
const TACTICS = `Fix each diagnostic at the cause its message names:
- No cast, wrapper, spread, suppression or file split just to pass; a documented exception carries its reason.
- Inline in evaluation order; move a declaration used before its definition up, never into a new module.
- Delete a whole unused declaration, never only its header.`

const cli = pipe(
	Command.make('coding-standards'),
	Command.withDescription('Lint tactics, semantic judging and sign-in'),
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
						Flag.withDescription('The user explicitly requested this run; allow more than 20 planned calls'),
						Flag.withDefault(false)
					)
				},
				input => judge(input, haiku)
			),
			'Ask the functions, components and test cases a change touches the questions no remembered answer covers, and report what breaks one'
		),
		Command.withDescription(
			Command.make('sign-in', {}, () => signIn),
			'Sign the judge in to Gateway once per machine'
		)
	]),
	Command.run({version: packageJson.version})
)

NodeRuntime.runMain(
	Effect.provide(
		cli,
		Layer.provideMerge(layerCache, Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp, NodeCrypto.layer))
	)
)
