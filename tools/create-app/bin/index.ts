#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, FileSystem, Number, Option, Path, Predicate, Schema, String, flow, pipe} from 'effect'

import {Generator, getConfig} from '@tanstack/router-generator'
import {Command, Flag} from 'effect/cli'

import {copyTemplate} from '@deslop/create-package'
import {nameFlag} from '@deslop/create-package/cli'

import packageJson from '#package.json' with {type: 'json'}

type AppPackage = typeof AppPackage.Type
const AppPackage = Schema.Struct({config: Schema.Struct({port: Schema.Int})})

const create = Command.make(
	'create-app',
	{
		kind: pipe(
			Flag.Literals('kind', ['web', 'mobile']),
			Flag.withDescription('A web app, or an iOS app with an Expo client'),
			Flag.withDefault('web')
		),
		name: nameFlag('Unscoped application name')
	},
	Effect.fnUntraced(function* (input) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const apps = path.resolve(import.meta.dirname, '../../../apps')
		const root = path.join(apps, input.name)
		// Each app listens on its own default port, so any two run side by side: the next after the highest taken.
		const ports = yield* Effect.forEach(
			yield* fs.readDirectory(apps),
			app =>
				pipe(
					fs.readFileString(path.join(apps, app, 'package.json')),
					Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(AppPackage))),
					Effect.map(found => Option.some(found.config.port)),
					Effect.catchTag('PlatformError', cause => {
						if (Predicate.isTagged(cause.reason, 'NotFound')) return Effect.succeedNone
						return Effect.fail(cause)
					})
				),
			{concurrency: 'unbounded'}
		)
		yield* copyTemplate({
			from: path.join(import.meta.dirname, '../template', input.kind),
			rewrite: flow(
				String.replaceAll('template-app', input.name),
				String.replaceAll('"port": 5100', `"port": ${Array.max([5100, ...Array.getSomes(ports)], Number.Order) + 1}`)
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
	Effect.provide(
		pipe(
			create,
			Command.withDescription('Create a full-stack Deslop application.'),
			Command.run({version: packageJson.version})
		),
		NodeServices.layer
	)
)
