// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Console, Effect, FileSystem, Path, String, pipe} from 'effect'

import {Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

const install = Effect.fn('Workflow.install')(function* (assets: string, codexHome: string, claudeHome: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const pair = yield* fs.readFileString(path.join(assets, 'pair.md'))
	const codexConfig = yield* fs.readFileString(path.join(assets, 'codex.toml'))
	const claudeSettings = yield* fs.readFileString(path.join(assets, 'claude.json'))
	const askGate = path.join(claudeHome, 'scripts/ask-gate.mjs')

	yield* fs.makeDirectory(codexHome, {recursive: true})
	for (const legacy of ['AGENTS.md', 'agents/deslop', 'skills/engineering']) {
		yield* fs.remove(path.join(codexHome, legacy), {force: true, recursive: true})
	}
	yield* fs.writeFileString(
		path.join(codexHome, 'config.toml'),
		`developer_instructions = '''\n${pair}'''\n\n${codexConfig}`
	)

	yield* fs.makeDirectory(path.join(claudeHome, 'scripts'), {recursive: true})
	yield* fs.writeFileString(path.join(claudeHome, 'CLAUDE.md'), pair)
	yield* fs.writeFileString(
		path.join(claudeHome, 'settings.json'),
		pipe(claudeSettings, String.replace('ASK_GATE', askGate))
	)
	yield* fs.copy(path.join(assets, 'scripts/ask-gate.mjs'), askGate, {overwrite: true})
	yield* fs.remove(path.join(claudeHome, 'agents'), {force: true, recursive: true})
	yield* fs.copy(path.join(assets, 'agents'), path.join(claudeHome, 'agents'))
	yield* fs.remove(path.join(claudeHome, 'skills/engineering'), {force: true, recursive: true})
	yield* fs.makeDirectory(path.join(claudeHome, 'skills'), {recursive: true})
	yield* fs.copy(path.join(assets, 'skills/engineering'), path.join(claudeHome, 'skills/engineering'))
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
			`Installed the pair thread in ${result.codexHome} and ${result.claudeHome}. Start a fresh session to load it.`
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
