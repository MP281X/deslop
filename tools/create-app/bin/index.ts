#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, Option, Path, Schema, String, flow, pipe} from 'effect'

import {Generator, getConfig} from '@tanstack/router-generator'
import {Command, Flag} from 'effect/cli'

import {copyTemplate} from '@deslop/create-package'

import packageJson from '#package' with {type: 'json'}

const create = Command.make(
	'create-app',
	{
		directory: pipe(Flag.String('directory'), Flag.withDescription('Defaults to apps/<name>'), Flag.optional),
		kind: pipe(
			Flag.Literals('kind', ['web', 'mobile']),
			Flag.withDescription('A web app, or an iOS app with an Expo client'),
			Flag.withDefault('web')
		),
		name: pipe(
			Flag.String('name'),
			Flag.withSchema(
				Schema.String.check(
					Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, {message: 'Use an unscoped kebab-case package name.'})
				)
			),
			Flag.withDescription('Unscoped application name')
		)
	},
	Effect.fnUntraced(function* (input) {
		const path = yield* Path.Path
		const root = Option.getOrElse(input.directory, () => path.join(import.meta.dirname, '../../../apps', input.name))
		yield* copyTemplate({
			from: path.join(import.meta.dirname, '../template', input.kind),
			rewrite: flow(
				String.replaceAll('@deslop/template-app', `@deslop/${input.name}`),
				String.replaceAll('template-app', input.name),
				String.replaceAll('../../../../tsconfig.json', '../../tsconfig.json')
			),
			to: root
		})
		if (input.kind === 'mobile') return
		yield* Effect.promise(() =>
			new Generator({
				config: getConfig(
					{autoCodeSplitting: true, target: 'react', tmpDir: path.join(root, 'node_modules/.cache/tanstack')},
					root
				),
				root
			}).run()
		)
	})
)

NodeRuntime.runMain(
	pipe(
		create,
		Command.withDescription('Create a full-stack Deslop application.'),
		Command.run({version: packageJson.version}),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer.
		Effect.provide(NodeServices.layer)
	)
)
