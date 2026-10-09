#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Config, Console, Effect, FileSystem, Path, Stream, String, pipe} from 'effect'
import type {PlatformError} from 'effect'

import {CliError, Command} from 'effect/cli'
import {ChildProcess} from 'effect/process'

import packageJson from '#package' with {type: 'json'}

const cli = pipe(
	Command.make(
		'deslop-coding-standards',
		{},
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const source = path.join(import.meta.dirname, '../skills')
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
				canonical
			)
			const entries = yield* fs.readDirectory(root)
			const directories = pipe(
				['.agents', '.claude', '.codex'],
				Array.filter(directory => Array.contains(entries, directory))
			)
			const targets = Array.dedupe([
				...directories,
				'.claude',
				...(Array.contains(directories, '.codex') ? [] : ['.agents'])
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
			for (const directory of targets) {
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
				for (const name of ['engineering', 'design', 'testing']) {
					const owned = path.join(skills, name)
					if (
						isGlobal(owned) ||
						Array.some(globals, global => pipe(global, String.startsWith(`${owned}${path.sep}`)))
					) {
						return yield* CliError.UserError.make({cause: `${owned} overlaps global agent configuration.`})
					}
				}
			}

			for (const directory of targets) {
				yield* fs.makeDirectory(path.join(root, directory, 'skills'), {recursive: true})
				for (const name of ['engineering', 'design', 'testing']) {
					const target = path.join(root, directory, 'skills', name)
					yield* fs.remove(target, {force: true, recursive: true})
					yield* fs.copy(path.join(source, name), target)
				}
			}

			yield* Console.log(
				`Installed engineering, design and testing in ${pipe(
					targets,
					Array.map(directory => path.join(root, directory, 'skills')),
					Array.join(', ')
				)}.`
			)
		})
	),
	Command.withDescription(
		'Run anywhere inside a Git repository to install engineering, design and testing at its root, including linked worktrees. Copies into skills/ under each existing .agents, .claude and .codex directory, always under .claude, and under .agents when no .codex exists. Replaces these three names, preserving other skills and global configuration. Destinations resolving outside the Git root are rejected before copying. Read engineering before coding, design before rendered output and testing before test work. Run the latest CLI transiently, independently of package preset versions; no repository dependency is needed. Claude uses .claude/skills; Codex documents .agents/skills for repository discovery. These skills belong in repositories, not global configuration.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/coding-standards@latest',
			description: 'Install or refresh this repository’s three skills without adding a dependency.'
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
