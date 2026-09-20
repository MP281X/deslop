// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, FileSystem, Path, Record, pipe} from 'effect'

import {Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

const install = Effect.fn('Workflow.install')(function* (assets: string, codexHome: string, claudeHome: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	for (const [source, home] of Record.toEntries({claude: claudeHome, codex: codexHome})) {
		yield* fs.makeDirectory(home, {recursive: true})
		for (const entry of yield* fs.readDirectory(path.join(assets, source))) {
			yield* fs.remove(path.join(home, entry), {force: true, recursive: true})
			yield* fs.copy(path.join(assets, source, entry), path.join(home, entry))
		}
		yield* fs.remove(path.join(home, 'skills/engineering'), {force: true, recursive: true})
		yield* fs.makeDirectory(path.join(home, 'skills'), {recursive: true})
		yield* fs.copy(path.join(assets, 'skills/engineering'), path.join(home, 'skills/engineering'))
	}
	yield* fs.remove(path.join(claudeHome, 'scripts'), {force: true, recursive: true})
	return {claudeHome, codexHome}
})

const cli = Command.make(
	'deslop-workflow',
	{},
	Effect.fnUntraced(function* () {
		const path = yield* Path.Path
		const codexHome = yield* pipe(Config.string('CODEX_HOME'), Config.withDefault(path.join(homedir(), '.codex')))
		const claudeHome = yield* pipe(
			Config.string('CLAUDE_CONFIG_DIR'),
			Config.withDefault(path.join(homedir(), '.claude'))
		)
		const result = yield* install(
			path.resolve(import.meta.dirname, '../assets'),
			path.resolve(codexHome),
			path.resolve(claudeHome)
		)
		yield* Console.log(
			`Installed the workflow in ${result.codexHome} and ${result.claudeHome}. Start a fresh session to load it.`
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
