// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, FileSystem, Path, Record, pipe} from 'effect'

import {Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

const install = Effect.fn('Workflow.install')(function* (agents: string, codexHome: string, claudeHome: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	for (const [source, home] of Record.toEntries({claude: claudeHome, codex: codexHome})) {
		yield* fs.makeDirectory(home, {recursive: true})
		for (const entry of yield* fs.readDirectory(path.join(agents, source))) {
			yield* fs.remove(path.join(home, entry), {force: true, recursive: true})
			yield* fs.copy(path.join(agents, source, entry), path.join(home, entry))
		}
		yield* fs.makeDirectory(path.join(home, 'skills'), {recursive: true})
		yield* fs.remove(path.join(home, 'skills', 'engineering'), {force: true, recursive: true})
		yield* fs.copy(path.join(agents, 'skills', 'engineering'), path.join(home, 'skills', 'engineering'))
	}
	// The pair prompt moved to the `pair` output style; drop the prompt file installed by earlier versions.
	yield* fs.remove(path.join(claudeHome, 'CLAUDE.md'), {force: true})
})

const cli = Command.make(
	'deslop-workflow',
	{},
	Effect.fnUntraced(function* () {
		const path = yield* Path.Path
		const codexHome = path.resolve(
			yield* pipe(Config.string('CODEX_HOME'), Config.withDefault(path.join(homedir(), '.codex')))
		)
		const claudeHome = path.resolve(
			yield* pipe(Config.string('CLAUDE_CONFIG_DIR'), Config.withDefault(path.join(homedir(), '.claude')))
		)
		yield* install(path.resolve(import.meta.dirname, '../src/agents'), codexHome, claudeHome)
		yield* Console.log(`Installed the workflow in ${codexHome} and ${claudeHome}. Start a fresh session to load it.`)
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
