#!/usr/bin/env node

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, Layer, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {judge, layerCache} from '#judge.ts'
import packageJson from '#package.json' with {type: 'json'}

import {signIn} from '#lib/session.ts'

// Printed after lint leaves a diagnostic, for the agent fixing it; autofix has already run.
const TACTICS = `Fix each diagnostic at the cause its message names:
- No cast, wrapper, spread, suppression or file split just to pass; a documented exception carries its reason.
- Inline in evaluation order; move a declaration used before its definition up, never into a new module.
- Delete a whole unused declaration, never only its header.`

const urls = {
	auth: pipe(
		Flag.String('auth'),
		Flag.withDescription('Deslop Auth origin'),
		Flag.withDefault('https://auth.mp281x.xyz')
	),
	gateway: pipe(
		Flag.String('gateway'),
		Flag.withDescription('Deslop Gateway origin, which spends your own OpenRouter key'),
		Flag.withDefault('https://gateway.mp281x.xyz')
	)
}

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
					...urls,
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
					ignore: pipe(
						Flag.String('ignore'),
						Flag.withDescription('A glob of changed files to leave unjudged, as lint ignores them'),
						Flag.atLeast(0)
					),
					maxCallTokens: pipe(
						Flag.Int('max-call-tokens'),
						Flag.withDescription('The most one call may send; a larger call is not sent and fails the run'),
						Flag.withDefault(64_000)
					)
				},
				input => judge(input, input)
			),
			'Ask the functions, components and test cases a change touches the questions no remembered answer covers, and report what breaks one'
		),
		Command.withDescription(Command.make('sign-in', urls, signIn), 'Sign the judge in to Gateway once per machine')
	]),
	Command.run({version: packageJson.version})
)

NodeRuntime.runMain(
	Effect.provide(
		cli,
		Layer.provideMerge(layerCache, Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp, NodeCrypto.layer))
	)
)
