#!/usr/bin/env node

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generator paths and CLI arguments are native Node boundaries.
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

import {NodeRuntime} from '@effect/platform-node'

import {Array, Context, Effect, Predicate, Record, String, pipe} from 'effect'

import {createTemplate, runTemplateCLI} from 'bingo'
import type {Template} from 'bingo'
import {intakeDirectory} from 'bingo-fs'
import type {CreatedDirectory, CreatedEntry, IntakeDirectory, IntakeEntry} from 'bingo-fs'
import {z} from 'zod'

const Name = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'Use an unscoped kebab-case package name.')
	.describe('Unscoped package name')
const TemplateDirectory = fileURLToPath(new URL('../template', import.meta.url))
const runPromise = Effect.runPromiseWith(Context.empty())

function replaceDirectory(directory: IntakeDirectory, name: string): CreatedDirectory {
	return pipe(
		directory,
		Record.filter(Predicate.isNotUndefined),
		Record.map(entry => replaceEntry(entry, name))
	)
}

function className(name: string) {
	return pipe(name, String.split('-'), Array.map(String.capitalize), Array.join(''))
}

function replaceContent(content: string, name: string) {
	return pipe(
		content,
		String.replaceAll('TemplatePackage', className(name)),
		String.replaceAll('@deslop/template-package', `@deslop/${name}`),
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
	about: {description: 'Create a standard Deslop package.', name: '@deslop/create-package'},
	options: {name: Name},
	produce: ({options}) =>
		pipe(
			Effect.tryPromise(() => intakeDirectory(TemplateDirectory, {exclude: /^(?:dist|node_modules)$/u})),
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
const directory = options.directory ?? `../packages/${options.name}`

if (Predicate.isUndefined(options.directory)) {
	process.argv = pipe(process.argv, Array.appendAll(['--directory', directory]))
}

NodeRuntime.runMain(
	pipe(
		Effect.promise(() =>
			// oxlint-disable-next-line @typescript-eslint/consistent-type-assertions -- Bingo's non-generic CLI signature erases the concrete option schema.
			runTemplateCLI(template as unknown as Template)
		),
		Effect.tap(status => Effect.sync(() => (process.exitCode = status)))
	)
)
