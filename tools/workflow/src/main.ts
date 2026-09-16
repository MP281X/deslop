// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, FileSystem, Option, Path, pipe} from 'effect'

import {Argument, Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

const install = Effect.fn('Workflow.install')(function* (source: string, destination: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const targets = [
		{source: 'codex/config.toml', target: 'config.toml'},
		{source: 'AGENTS.md', target: 'AGENTS.md'},
		{source: 'codex/agents', target: 'agents/deslop'},
		{source: 'skills/engineering', target: 'skills/engineering'},
		{source: 'skills/workflow', target: 'skills/workflow'}
	]

	yield* fs.makeDirectory(destination, {recursive: true})
	yield* fs.makeDirectory(path.join(destination, 'agents'), {recursive: true})
	yield* fs.makeDirectory(path.join(destination, 'skills'), {recursive: true})

	for (const target of targets) {
		const installed = path.join(destination, target.target)
		yield* fs.remove(installed, {force: true, recursive: true})
		yield* fs.copy(path.join(source, target.source), installed)
	}
	return {directory: destination}
})

const cli = Command.make(
	'deslop-workflow',
	{codexHome: pipe(Argument.string('codex-home'), Argument.optional)},
	Effect.fnUntraced(function* ({codexHome}) {
		const path = yield* Path.Path
		const destination = yield* Option.match(codexHome, {
			onNone: () => pipe(Config.string('CODEX_HOME'), Config.withDefault(path.join(homedir(), '.codex'))),
			onSome: Effect.succeed
		})
		const result = yield* install(path.resolve(import.meta.dirname, '../assets'), path.resolve(destination))
		yield* Console.log(`Installed Deslop workflow in ${result.directory}`)
		yield* Console.log(
			'Start a fresh Codex session to load the installed workflow. Existing config.toml settings were replaced.'
		)
	})
)

NodeRuntime.runMain(
	pipe(
		cli,
		Command.run({version: packageJson.version}),
		Effect.scoped,
		// This CLI entrypoint owns the single platform Layer and its resource lifetime.
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(NodeServices.layer)
	)
)
