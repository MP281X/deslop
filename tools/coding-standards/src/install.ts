#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Boolean, Config, Console, Effect, FileSystem, Path, Stream, String, pipe} from 'effect'
import type {PlatformError} from 'effect'

import {CliError, Command} from 'effect/cli'
import {ChildProcess} from 'effect/process'

import packageJson from '#package.json' with {type: 'json'}

const cli = pipe(
	Command.make(
		'deslop-coding-standards',
		{},
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const source = path.join(import.meta.dirname, '../skills')
			const names = yield* fs.readDirectory(source)
			const handle = yield* ChildProcess.make('git', ['rev-parse', '--show-toplevel'], {stdout: 'pipe'})
			const result = yield* Effect.all(
				{exitCode: handle.exitCode, stdout: Stream.mkString(Stream.decodeText(handle.stdout))},
				{concurrency: 'unbounded'}
			)
			if (result.exitCode !== 0) {
				return yield* CliError.UserError.make({cause: 'Run inside a Git repository to install its skills.'})
			}
			const root = yield* fs.realPath(String.trimEnd(result.stdout))
			const home = yield* fs.realPath(yield* Config.String('HOME'))
			const canonical = Effect.fnUntraced(function* (
				directory: string
			): Effect.fn.Return<string, PlatformError.PlatformError> {
				if (yield* fs.exists(directory)) return yield* fs.realPath(directory)
				return path.join(yield* canonical(path.dirname(directory)), path.basename(directory))
			})
			const globals = yield* Effect.forEach(
				Array.dedupe([
					path.join(home, '.agents'),
					path.join(home, '.claude'),
					path.join(home, '.codex'),
					yield* pipe(Config.String('CLAUDE_CONFIG_DIR'), Config.withDefault(path.join(home, '.claude'))),
					yield* pipe(Config.String('CODEX_HOME'), Config.withDefault(path.join(home, '.codex')))
				]),
				canonical,
				{concurrency: 'unbounded'}
			)
			const entries = yield* fs.readDirectory(root)
			const directories = pipe(
				['.agents', '.claude', '.codex'],
				Array.filter(directory => Array.contains(entries, directory))
			)
			const targets = Array.dedupe([
				...directories,
				'.claude',
				...Boolean.match(Array.contains(directories, '.codex'), {
					onFalse: () => ['.agents'],
					onTrue: () => Array.empty<string>()
				})
			])

			function isGlobal(destination: string) {
				return Array.some(
					globals,
					global => destination === global || pipe(destination, String.startsWith(`${global}${path.sep}`))
				)
			}
			const validate = Effect.fnUntraced(function* (ancestor: string) {
				const resolved = yield* fs.realPath(ancestor)
				if (isGlobal(resolved)) {
					return yield* CliError.UserError.make({cause: `${ancestor} resolves into global agent configuration.`})
				}
				const relative = path.relative(root, resolved)
				if (relative === '..' || pipe(relative, String.startsWith(`..${path.sep}`))) {
					return yield* CliError.UserError.make({cause: `${ancestor} resolves outside this Git repository.`})
				}
			})
			yield* Effect.forEach(
				targets,
				Effect.fnUntraced(function* (directory: string) {
					const target = path.join(root, directory)
					if (isGlobal(target)) {
						return yield* CliError.UserError.make({cause: `${target} resolves into global agent configuration.`})
					}
					if (Array.contains(entries, directory)) {
						yield* validate(target)
						if (Array.contains(yield* fs.readDirectory(target), 'skills')) {
							yield* validate(path.join(target, 'skills'))
						}
					}
					const skills = yield* canonical(path.join(target, 'skills'))
					for (const name of names) {
						const owned = path.join(skills, name)
						if (
							isGlobal(owned) ||
							Array.some(globals, global => pipe(global, String.startsWith(`${owned}${path.sep}`)))
						) {
							return yield* CliError.UserError.make({cause: `${owned} overlaps global agent configuration.`})
						}
					}
				}),
				{concurrency: 1, discard: true}
			)

			for (const directory of targets) {
				yield* fs.makeDirectory(path.join(root, directory, 'skills'), {recursive: true})
				for (const name of names) {
					const target = path.join(root, directory, 'skills', name)
					yield* fs.remove(target, {force: true, recursive: true})
					yield* fs.copy(path.join(source, name), target)
				}
			}

			yield* Console.log(
				`Installed ${Array.join(names, ', ')} in ${pipe(
					targets,
					Array.map(directory => path.join(root, directory, 'skills')),
					Array.join(', ')
				)}.`
			)
		})
	),
	Command.withDescription(
		'Install the package’s writing-code, pull-requests and review skills at the Git repository root, including linked worktrees. Copy into each existing .agents, .claude and .codex skills directory, always .claude, and .agents when no .codex exists. Replace only package-owned names; preserve other skills and global configuration. Reject destinations outside the repository before copying. Refer to skills by name. Run the latest CLI transiently without adding a dependency. These skills belong in repositories, not global configuration.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/coding-standards@latest',
			description: 'Install or refresh this repository’s shared skills without adding a dependency.'
		}
	])
)

NodeRuntime.runMain(
	pipe(
		cli,
		Command.run({version: packageJson.version}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(NodeServices.layer)
	)
)
