// The operating system owns the user's home directory at the CLI boundary.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {homedir} from 'node:os'

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Config, Console, Effect, FileSystem, Option, Path, String, pipe} from 'effect'

import {Command} from 'effect/unstable/cli'

import packageJson from '#package' with {type: 'json'}

// One agent source serves both harnesses: Claude Code reads the frontmatter as is, Codex gets a role file from the
// `codex-*` lines and the body.
function parseAgent(source: string) {
	const [, frontmatter = '', body = ''] = pipe(
		source,
		String.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u),
		Option.getOrElse(() => [])
	)
	const lines = String.split(frontmatter, '\n')
	function field(key: string) {
		return pipe(
			Array.findFirst(lines, line => String.startsWith(`${key}:`)(line)),
			Option.map(line => String.trim(String.slice(key.length + 1)(line))),
			Option.getOrElse(() => '')
		)
	}
	const claude = pipe(
		lines,
		Array.filter(line => !String.startsWith('codex-')(line)),
		Array.join('\n')
	)
	return {
		body: String.trim(body),
		claude: `---\n${claude}\n---\n\n${String.trim(body)}\n`,
		codexEffort: field('codex-effort'),
		codexModel: field('codex-model'),
		description: field('description'),
		name: field('name')
	}
}

type Agent = ReturnType<typeof parseAgent>

function codexRole(agent: Agent) {
	return `model = "${agent.codexModel}"\nmodel_reasoning_effort = "${agent.codexEffort}"\nnickname_candidates = ["${String.capitalize(agent.name)}"]\ndeveloper_instructions = '''\n${agent.body}\n'''\n`
}

function codexRegistration(agent: Agent) {
	return `\n[agents.${agent.name}]\ndescription = "${agent.description}"\nconfig_file = "./agents/${agent.name}.toml"\n`
}

const install = Effect.fn('Workflow.install')(function* (assets: string, codexHome: string, claudeHome: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const pair = yield* fs.readFileString(path.join(assets, 'pair.md'))
	const codexConfig = yield* fs.readFileString(path.join(assets, 'codex.toml'))
	const claudeSettings = yield* fs.readFileString(path.join(assets, 'claude.json'))
	const agentFiles = yield* fs.readDirectory(path.join(assets, 'agents'))
	const agents = yield* Effect.forEach(agentFiles, file =>
		pipe(fs.readFileString(path.join(assets, 'agents', file)), Effect.map(parseAgent))
	)
	const askGate = path.join(claudeHome, 'scripts/ask-gate.mjs')

	yield* fs.makeDirectory(path.join(codexHome, 'agents'), {recursive: true})
	for (const legacy of ['agents/deslop', 'skills/engineering']) {
		yield* fs.remove(path.join(codexHome, legacy), {force: true, recursive: true})
	}
	yield* fs.writeFileString(
		path.join(codexHome, 'config.toml'),
		`developer_instructions = '''\n${pair}'''\n\n${codexConfig}${Array.join(Array.map(agents, codexRegistration), '')}`
	)
	yield* Effect.forEach(agents, agent =>
		fs.writeFileString(path.join(codexHome, 'agents', `${agent.name}.toml`), codexRole(agent))
	)
	// Codex authorizes spawning only from AGENTS.md or a skill, never from developer instructions.
	yield* fs.writeFileString(
		path.join(codexHome, 'AGENTS.md'),
		`The primary agent delegates to the configured agents: ${Array.join(
			Array.map(agents, agent => `\`${agent.name}\``),
			', '
		)}. Spawning them is authorized whenever the developer instructions call for it.\n`
	)

	yield* fs.makeDirectory(path.join(claudeHome, 'scripts'), {recursive: true})
	yield* fs.remove(path.join(claudeHome, 'agents'), {force: true, recursive: true})
	yield* fs.makeDirectory(path.join(claudeHome, 'agents'), {recursive: true})
	yield* fs.writeFileString(path.join(claudeHome, 'CLAUDE.md'), pair)
	yield* fs.writeFileString(
		path.join(claudeHome, 'settings.json'),
		pipe(claudeSettings, String.replace('ASK_GATE', askGate))
	)
	yield* fs.copy(path.join(assets, 'scripts/ask-gate.mjs'), askGate, {overwrite: true})
	yield* Effect.forEach(agents, agent =>
		fs.writeFileString(path.join(claudeHome, 'agents', `${agent.name}.md`), agent.claude)
	)
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
