#!/usr/bin/env node

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generator paths and CLI arguments are native Node boundaries.
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

import {NodeFileSystem, NodeRuntime} from '@effect/platform-node'

import {Array, Context, Effect, FileSystem, Predicate, Record, String, pipe} from 'effect'

import {Generator, getConfig} from '@tanstack/router-generator'
import {createTemplate, runTemplateCLI} from 'bingo'
import type {Template} from 'bingo'
import {intakeDirectory} from 'bingo-fs'
import type {CreatedDirectory, CreatedEntry, IntakeDirectory, IntakeEntry} from 'bingo-fs'
import {z} from 'zod'

const Name = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'Use an unscoped kebab-case package name.')
	.describe('Unscoped application name')
const TemplateDirectory = fileURLToPath(new URL('../template', import.meta.url))
const runPromise = Effect.runPromiseWith(Context.empty())

function replaceDirectory(directory: IntakeDirectory, name: string): CreatedDirectory {
	return pipe(
		directory,
		Record.filter(Predicate.isNotUndefined),
		Record.map(entry => replaceEntry(entry, name))
	)
}

function replaceContent(content: string, name: string) {
	return pipe(
		content,
		String.replaceAll('@deslop/template-app', `@deslop/${name}`),
		String.replaceAll('template-app', name),
		String.replaceAll('../../../tsconfig.json', '../../tsconfig.json')
	)
}

function replaceEntry(entry: IntakeEntry, name: string): CreatedEntry {
	if (Array.isArray(entry)) {
		const [content, metadata] = entry
		const replaced = replaceContent(content, name)
		return Predicate.isUndefined(metadata) ? [replaced] : [replaced, metadata]
	}

	return replaceDirectory(entry, name)
}

const template = createTemplate({
	about: {description: 'Create a full-stack Deslop application.', name: '@deslop/create-app'},
	options: {name: Name},
	produce: ({options}) =>
		pipe(
			Effect.tryPromise(() =>
				intakeDirectory(TemplateDirectory, {exclude: /^(?:dist|icon\.png|node_modules|routeTree\.gen\.ts)$/u})
			),
			Effect.map(files => ({files: replaceDirectory(files, options.name), requests: [], scripts: [], suggestions: []})),
			runPromise
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
				const fileSystem = yield* FileSystem.FileSystem
				yield* fileSystem.copyFile(icon, resolve(root, 'src/routes/icon.png'))
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
