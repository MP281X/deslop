#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, Option, Path, Schema, String, flow, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {copyTemplate} from '#copy-template'
import packageJson from '#package' with {type: 'json'}

const create = Command.make(
	'create-package',
	{
		directory: pipe(Flag.String('directory'), Flag.withDescription('Defaults to packages/<name>'), Flag.optional),
		name: pipe(
			Flag.String('name'),
			Flag.withSchema(
				Schema.String.check(
					Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, {message: 'Use an unscoped kebab-case package name.'})
				)
			),
			Flag.withDescription('Unscoped package name')
		)
	},
	Effect.fnUntraced(function* (input) {
		const path = yield* Path.Path
		yield* copyTemplate({
			from: path.join(import.meta.dirname, '../template'),
			rewrite: flow(
				String.replaceAll(
					'TemplatePackage',
					pipe(input.name, String.split('-'), Array.map(String.capitalize), Array.join(''))
				),
				String.replaceAll('@deslop/template-package', `@deslop/${input.name}`),
				String.replaceAll('../../../tsconfig.json', '../../tsconfig.json')
			),
			to: Option.getOrElse(input.directory, () => path.join(import.meta.dirname, '../../../packages', input.name))
		})
	})
)

NodeRuntime.runMain(
	pipe(
		create,
		Command.withDescription('Create a standard Deslop package.'),
		Command.run({version: packageJson.version}),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer.
		Effect.provide(NodeServices.layer)
	)
)
