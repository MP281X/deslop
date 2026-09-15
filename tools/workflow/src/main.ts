// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, Option, Path, pipe} from 'effect'

import {Argument, Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

import {install} from './install.ts'

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
		yield* Console.log('Restart Codex to load the installed workflow. Existing config.toml settings were replaced.')
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
