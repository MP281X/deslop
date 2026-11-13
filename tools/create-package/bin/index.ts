#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, Path, String, pipe} from 'effect'

import {Command} from 'effect/cli'

import {nameFlag} from '#cli.ts'
import {copyTemplate} from '#copy-template.ts'
import packageJson from '#package.json' with {type: 'json'}

const create = Command.make(
	'create-package',
	{name: nameFlag('Unscoped package name')},
	Effect.fnUntraced(function* (input) {
		const path = yield* Path.Path
		yield* copyTemplate({
			from: path.join(import.meta.dirname, '../template'),
			rewrite: content =>
				pipe(
					content,
					String.replaceAll('template-package', input.name),
					String.replaceAll('TemplatePackage', String.pascalCase(input.name))
				),
			to: path.resolve(import.meta.dirname, '../../../packages', input.name)
		})
	})
)

NodeRuntime.runMain(
	Effect.provide(
		pipe(
			create,
			Command.withDescription('Create a standard Deslop package.'),
			Command.run({version: packageJson.version})
		),
		NodeServices.layer
	)
)
