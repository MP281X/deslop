#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, Schema, String, pipe} from 'effect'

import {Argument, Command} from 'effect/cli'

import packageJson from '#package' with {type: 'json'}

import {collect, recordRun} from '#lib/collect'
import {activate, cleanup, command, prepare} from '#lib/prepare'

const commands = [
	Command.make(
		'prepare',
		{skill: Argument.String('skill')},
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
					yield* prepare({
						...input,
						harnesses: ['codex'],
						root: String.trim(yield* command('.', 'git', ['rev-parse', '--show-toplevel']))
					})
				)
			)
		})
	),
	Command.make(
		'activate',
		{directory: Argument.String('directory'), id: Argument.String('run-id')},
		Effect.fnUntraced(function* (input) {
			yield* activate(input.directory, input.id, yield* Config.String('HOME'))
		})
	),
	Command.make(
		'cleanup-run',
		{directory: Argument.String('directory'), id: Argument.String('run-id')},
		Effect.fnUntraced(function* (input) {
			yield* cleanup(input.directory, yield* Config.String('HOME'), input.id)
		})
	),
	Command.make(
		'record',
		{directory: Argument.String('directory'), id: Argument.String('run-id'), threadId: Argument.String('thread-id')},
		Effect.fnUntraced(function* (input) {
			yield* recordRun(input.directory, input.id, input.threadId)
		})
	),
	Command.make(
		'collect',
		{directory: Argument.String('directory')},
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
					yield* collect(input.directory, yield* Config.String('HOME'))
				)
			)
		})
	),
	Command.make(
		'cleanup',
		{directory: Argument.String('directory')},
		Effect.fnUntraced(function* (input) {
			yield* cleanup(input.directory, yield* Config.String('HOME'))
		})
	)
]

NodeRuntime.runMain(
	pipe(
		Command.make('deslop-evals'),
		Command.withSubcommands(commands),
		Command.run({version: packageJson.version}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI owns platform resources for its command lifetime.
		Effect.provide(NodeServices.layer)
	)
)
