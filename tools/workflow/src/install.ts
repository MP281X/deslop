import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, FileSystem, Path, Record, pipe} from 'effect'

import {Command} from 'effect/cli'

import packageJson from '#package' with {type: 'json'}

const cli = Command.make(
	'deslop-workflow',
	{},
	Effect.fnUntraced(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const home = yield* Config.String('HOME')
		const codexHome = yield* pipe(Config.String('CODEX_HOME'), Config.withDefault(path.join(home, '.codex')))
		const claudeHome = yield* pipe(Config.String('CLAUDE_CONFIG_DIR'), Config.withDefault(path.join(home, '.claude')))
		const agents = path.join(import.meta.dirname, 'agents')

		for (const target of Record.toEntries({claude: claudeHome, codex: codexHome})) {
			for (const entry of yield* fs.readDirectory(path.join(agents, target[0]))) {
				yield* fs.remove(path.join(target[1], entry), {force: true, recursive: true})
				yield* fs.copy(path.join(agents, target[0], entry), path.join(target[1], entry))
			}
			for (const skill of yield* fs.readDirectory(path.join(agents, 'skills'))) {
				yield* fs.remove(path.join(target[1], 'skills', skill), {force: true, recursive: true})
				yield* fs.copy(path.join(agents, 'skills', skill), path.join(target[1], 'skills', skill))
			}
		}

		yield* Console.log(`Installed the workflow in ${codexHome} and ${claudeHome}. Start a fresh session to load it.`)
	})
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
