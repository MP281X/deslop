#!/usr/bin/env node

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Boolean, Console, Effect, Layer, Schema, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {judge, layerCache} from '#judge.ts'
import {mapOf} from '#map.ts'
import packageJson from '#package.json' with {type: 'json'}

import {signIn} from '#lib/session.ts'
import {markdownOf} from '#map/render.ts'

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
	Command.make(
		'coding-standards',
		{
			...urls,
			ignore: pipe(
				Flag.String('ignore'),
				Flag.withDescription('With --judge, a glob of files to leave unjudged, as lint ignores them'),
				Flag.atLeast(0)
			),
			judge: pipe(
				Flag.Boolean('judge'),
				Flag.withDescription(
					'Ask every function, component and test case the questions no cached answer covers, and report what breaks one'
				),
				Flag.withDefault(false)
			)
		},
		input => Boolean.match(input.judge, {onFalse: () => Console.log(TACTICS), onTrue: () => judge(input, input.ignore)})
	),
	Command.withDescription('Lint tactics for a diagnostic lint leaves; `--judge` asks Jev what lint cannot see.'),
	Command.withSubcommands([
		pipe(
			Command.make('sign-in', urls, signIn),
			Command.withDescription('Sign the judge in to Gateway once per machine')
		),
		pipe(
			Command.make(
				'map',
				{
					base: pipe(
						Flag.String('base'),
						Flag.withDescription(
							"The commit before the change; default: HEAD's merge base with origin's default branch"
						),
						Flag.optional
					),
					head: pipe(Flag.String('head'), Flag.withDescription('The changed commit'), Flag.withDefault('HEAD')),
					json: pipe(
						Flag.Boolean('json'),
						Flag.withDescription('Print the facts as JSON for the judge instead of Markdown'),
						Flag.withDefault(false)
					)
				},
				input =>
					Effect.flatMap(mapOf(input.base, input.head), map =>
						Boolean.match(input.json, {
							onFalse: () => Console.log(markdownOf(map)),
							onTrue: () =>
								Effect.flatMap(
									Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, {space: '\t'}))(map),
									Console.log
								)
						})
					)
			),
			Command.withDescription('Print the change map of a commit range: touched packages, contracts and diagrams')
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
