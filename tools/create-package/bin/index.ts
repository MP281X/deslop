#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, Option, Path, String, flow, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {generatorProgram, nameFlag} from '#cli.ts'
import {copyTemplate} from '#copy-template.ts'
import packageJson from '#package.json' with {type: 'json'}

const create = Command.make(
	'create-package',
	{
		directory: pipe(Flag.String('directory'), Flag.withDescription('Defaults to packages/<name>'), Flag.optional),
		name: nameFlag('Unscoped package name')
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
				String.replaceAll('@deslop/template-package', `@deslop/${input.name}`)
			),
			to: Option.getOrElse(input.directory, () => path.join(import.meta.dirname, '../../../packages', input.name))
		})
	})
)

NodeRuntime.runMain(
	Effect.provide(
		generatorProgram({command: create, description: 'Create a standard Deslop package.', version: packageJson.version}),
		NodeServices.layer
	)
)
