#!/usr/bin/env node

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generator paths and CLI arguments are native Node boundaries.
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

import {NodeFileSystem, NodeRuntime} from '@effect/platform-node'

import {Array, Context, Effect, FileSystem, Predicate, String, flow, pipe} from 'effect'

import {Generator, getConfig} from '@tanstack/router-generator'
import {createTemplate, runTemplateCLI} from 'bingo'
import type {Template, TemplateContext} from 'bingo'
import {intakeDirectory} from 'bingo-fs'
import {z} from 'zod'

import {replaceDirectory} from '@deslop/create-package'

const Name = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'Use an unscoped kebab-case package name.')
	.describe('Unscoped application name')
const TemplateDirectory = fileURLToPath(new URL('../template', import.meta.url))

const template = createTemplate({
	about: {description: 'Create a full-stack Deslop application.', name: '@deslop/create-app'},
	options: {name: Name},
	produce: flow(
		Effect.fnUntraced(function* (context: TemplateContext<{name: string}, unknown>) {
			const files = yield* Effect.tryPromise(() =>
				intakeDirectory(TemplateDirectory, {exclude: /^(?:dist|icon\.png|node_modules|routeTree\.gen\.ts)$/u})
			)
			return {
				files: replaceDirectory(
					files,
					flow(
						String.replaceAll('@deslop/template-app', `@deslop/${context.options.name}`),
						String.replaceAll('template-app', context.options.name),
						String.replaceAll('../../../tsconfig.json', '../../tsconfig.json')
					)
				),
				requests: [],
				scripts: [],
				suggestions: []
			}
		}),
		Effect.runPromiseWith(Context.empty())
	)
})

const parsedArguments = parseArgs({
	args: Array.drop(process.argv, 2),
	options: {directory: {type: 'string'}, name: {type: 'string'}},
	strict: false
})
const options = z.object({directory: z.string().optional(), name: Name}).parse(parsedArguments.values)
const directory = options.directory ?? `../apps/${options.name}`

if (Predicate.isUndefined(options.directory)) {
	process.argv = pipe(process.argv, Array.appendAll(['--directory', directory]))
}

const icon = fileURLToPath(new URL('../template/src/routes/icon.png', import.meta.url))

NodeRuntime.runMain(
	pipe(
		Effect.promise(() =>
			// oxlint-disable-next-line @typescript-eslint/consistent-type-assertions -- Bingo's non-generic CLI signature erases the concrete option schema.
			runTemplateCLI(template as unknown as Template)
		),
		Effect.flatMap(status => {
			if (status !== 0) return Effect.sync(() => (process.exitCode = status))

			return Effect.gen(function* () {
				const root = resolve(directory)
				yield* (yield* FileSystem.FileSystem).copyFile(icon, resolve(root, 'src/routes/icon.png'))
				yield* Effect.promise(() =>
					new Generator({
						config: getConfig(
							{autoCodeSplitting: true, target: 'react', tmpDir: resolve(root, 'node_modules/.cache/tanstack')},
							root
						),
						root
					}).run()
				)
			})
		}),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the filesystem runtime.
		Effect.provide(NodeFileSystem.layer)
	)
)
