#!/usr/bin/env node

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generator paths and CLI arguments are native Node boundaries.
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

import {NodeRuntime} from '@effect/platform-node'

import {Array, Context, Effect, Predicate, String, flow, pipe} from 'effect'

import {createTemplate, runTemplateCLI} from 'bingo'
import type {Template, TemplateContext} from 'bingo'
import {intakeDirectory} from 'bingo-fs'
import {z} from 'zod'

import {replaceDirectory} from '#replace-directory'

const Name = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'Use an unscoped kebab-case package name.')
	.describe('Unscoped package name')
const TemplateDirectory = fileURLToPath(new URL('../template', import.meta.url))

const template = createTemplate({
	about: {description: 'Create a standard Deslop package.', name: '@deslop/create-package'},
	options: {name: Name},
	produce: flow(
		Effect.fnUntraced(function* (context: TemplateContext<{name: string}, unknown>) {
			const files = yield* Effect.tryPromise(() =>
				intakeDirectory(TemplateDirectory, {exclude: /^(?:dist|node_modules)$/u})
			)
			return {
				files: replaceDirectory(
					files,
					flow(
						String.replaceAll(
							'TemplatePackage',
							pipe(context.options.name, String.split('-'), Array.map(String.capitalize), Array.join(''))
						),
						String.replaceAll('@deslop/template-package', `@deslop/${context.options.name}`),
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
