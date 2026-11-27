#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Effect, FileSystem, Number, Option, Path, Predicate, Schema, String, flow, pipe} from 'effect'

import {CliError, Command} from 'effect/cli'

import {copyTemplate} from '@deslop/create-package'
import {nameFlag} from '@deslop/create-package/cli'

import packageJson from '#package.json' with {type: 'json'}

type Port = typeof Port.Type
const Port = Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024}))

type AppPackage = typeof AppPackage.Type
const AppPackage = Schema.Struct({config: Schema.Struct({port: Port})})

const create = Command.make(
	'create-app',
	{name: nameFlag('Unscoped application name')},
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
					Effect.flatMap(content =>
						Effect.mapError(Schema.decodeEffect(Schema.fromJsonString(AppPackage))(content), cause =>
							CliError.UserError.make({
								cause,
								userMessage: `${path.join(apps, app, 'package.json')} needs config.port, an integer from 1024 to 65535.`
							})
						)
					),
					Effect.map(found => Option.some(found.config.port)),
					Effect.catchTag('PlatformError', cause => {
						if (Predicate.isTagged(cause.reason, 'NotFound')) return Effect.succeedNone
						return Effect.fail(cause)
					})
				),
			{concurrency: 'unbounded'}
		)
		const port = yield* Effect.mapError(
			Schema.decodeEffect(Port)(Array.max([5100, ...Array.getSomes(ports)], Number.Order) + 1),
			cause => CliError.UserError.make({cause, userMessage: 'No default port is left above the highest an app takes.'})
		)
		const template = path.join(import.meta.dirname, '../template')
		yield* copyTemplate({
			from: [template],
			rewrite: flow(
				// Bundle identifier segments start with a letter.
				String.replaceAll('templateBundleSlug', String.replaceAll('-', '.x')(input.name)),
				String.replaceAll('template-app', input.name),
				String.replaceAll('"port": 5100', `"port": ${port}`)
			),
			to: root
		})
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
