#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, FileSystem, Path, Stream, String, pipe} from 'effect'

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
			const root = String.trimEnd(result.stdout)

			for (const directory of ['.agents/skills', '.claude/skills']) {
				yield* fs.makeDirectory(path.join(root, directory), {recursive: true})
				for (const name of ['engineering', 'design', 'testing']) {
					const target = path.join(root, directory, name)
					yield* fs.remove(target, {force: true, recursive: true})
					yield* fs.copy(path.join(source, name), target)
				}
			}

			yield* Console.log(
				`Installed engineering, design and testing in ${root}/.agents/skills and ${root}/.claude/skills.`
			)
		})
	),
	Command.withDescription(
		'Run anywhere inside a Git repository to install the engineering, design and testing skills paired with @deslop/coding-standards static analysis at its root, including linked worktrees. Replaces only these three names in .agents/skills (Codex) and .claude/skills (Claude Code), preserving unrelated skills and all global configuration. Read engineering before coding, design before rendered output and testing before test work. Rerun after upgrading the package. Claude personal skills override project skills: remove older global copies only after provisioning every repository that uses them.'
	),
	Command.withExamples([
		{command: 'deslop-coding-standards', description: 'Install or update this repository’s three skills.'}
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
