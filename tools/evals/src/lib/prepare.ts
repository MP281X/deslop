import {Array, Boolean, Effect, Exit, FileSystem, Option, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import packageJson from '#package' with {type: 'json'}
import {EvalCase, EvalError, Manifest} from '#schema'
import type {Run} from '#schema'

export type Settings = typeof Settings.Type
export const Settings = Schema.StructWithRest(
	Schema.Struct({providerInstances: Schema.Record(Schema.String, Schema.Unknown)}),
	[Schema.Record(Schema.String, Schema.Unknown)]
)

const harnesses = {
	claude: {
		auth: '.credentials.json',
		driver: 'claudeAgent',
		launchArgs: (home: string) => `--system-prompt-snapshot off --agent pair --settings ${home}/settings.json`
	},
	codex: {
		auth: 'auth.json',
		driver: 'codex',
		launchArgs: (home: string) => `-c model_instructions_file=${home}/instructions.md`
	}
}

export const command = Effect.fnUntraced(function* (cwd: string, program: string, args: string[]) {
	const handle = yield* ChildProcess.make(program, args, {cwd, stderr: 'pipe', stdout: 'pipe'})
	const result = yield* Effect.all(
		{
			exitCode: handle.exitCode,
			stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
			stdout: Stream.mkString(Stream.decodeText(handle.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (result.exitCode !== 0) {
		return yield* EvalError.make({message: `${program} exited ${result.exitCode}: ${result.stderr}${result.stdout}`})
	}
	return result.stdout
})

export const parseCases = Effect.fnUntraced(function* (text: string) {
	const cases = yield* Effect.forEach(Array.drop(String.split(text, /^## /mu), 1), body =>
		Effect.gen(function* () {
			const sections = String.split(body, /^### (?=Task$|Criteria$)/mu)
			const names = Array.map(Array.drop(sections, 1), section => String.trim(String.split(section, '\n')[0]))
			if (Array.dedupe(names).length !== names.length) {
				return yield* EvalError.make({message: 'Repeated evaluation section'})
			}
			const values = Record.fromEntries(
				Array.map(Array.drop(sections, 1), section => {
					const lines = String.split(section, '\n')
					return [String.trim(lines[0]), String.trim(Array.join(Array.drop(lines, 1), '\n'))]
				})
			)
			return yield* Schema.decodeUnknownEffect(EvalCase)({
				criteria: values['Criteria'],
				id: String.trim(sections[0]),
				task: values['Task']
			})
		})
	)
	if (Array.isReadonlyArrayEmpty(cases)) return yield* EvalError.make({message: 'EVALS.md has no cases'})
	return cases
})

export const prepare = Effect.fn('Evals.prepare')(function* (input: {
	root: string
	skill: string
	harnesses: Run['harness'][]
}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const skill = yield* fs.realPath(path.resolve(input.skill))
	const name = path.basename(skill)
	const cases = yield* parseCases(yield* fs.readFileString(path.join(skill, 'EVALS.md')))
	const files = [
		'.claude/settings.json',
		'.claude/agents/pair.md',
		'.codex/config.toml',
		'.codex/instructions.md',
		'.codex/rules/deny.rules'
	]
	const directory = yield* fs.makeTempDirectory({prefix: 'deslop-evals-'})
	const starter = path.resolve(import.meta.dirname, '../../starter/importer')
	const runs = yield* pipe(
		fs.makeDirectory(path.join(directory, 'criteria')),
		Effect.andThen(
			Effect.forEach(cases, item =>
				fs.writeFileString(path.join(directory, 'criteria', `${item.id}.md`), item.criteria)
			)
		),
		Effect.andThen(
			Effect.forEach(
				Array.cartesian(cases, input.harnesses),
				pair =>
					Effect.gen(function* () {
						const item = pair[0]
						const harness = pair[1]
						const id = `${item.id}-${harness}`
						const home = path.join(directory, 'homes', id)
						const repo = path.join(directory, 'runs', id, 'repo')
						yield* fs.makeDirectory(home, {recursive: true})
						yield* fs.makeDirectory(repo, {recursive: true})
						const sources = Boolean.match(name === 'testing', {
							onFalse: () => [starter],
							onTrue: () => [starter, path.resolve(import.meta.dirname, '../../starter/folder-import')]
						})
						for (const source of sources) {
							yield* Effect.forEach(
								yield* fs.glob('**/*', {exclude: ['node_modules/**', '.git/**'], root: source}),
								file =>
									Effect.gen(function* () {
										if ((yield* fs.stat(path.join(source, file))).type === 'Directory') return
										yield* fs.makeDirectory(path.dirname(path.join(repo, file)), {recursive: true})
										yield* fs.copyFile(path.join(source, file), path.join(repo, file))
									})
							)
						}
						yield* fs.copyFile(path.join(starter, '.gitignore'), path.join(repo, '.gitignore'))
						yield* fs.makeDirectory(path.join(repo, 'artifacts'))
						for (const root of ['.claude', '.codex']) {
							const destination = path.join(repo, root, 'skills', name)
							yield* Effect.forEach(yield* fs.glob('**/*', {exclude: ['EVALS.md'], root: skill}), file =>
								Effect.gen(function* () {
									if ((yield* fs.stat(path.join(skill, file))).type === 'Directory') return
									yield* fs.makeDirectory(path.dirname(path.join(destination, file)), {recursive: true})
									yield* fs.copyFile(path.join(skill, file), path.join(destination, file))
								})
							)
						}
						for (const file of files) {
							yield* fs.makeDirectory(path.dirname(path.join(repo, file)), {recursive: true})
							yield* fs.copyFile(path.join(input.root, file), path.join(repo, file))
						}
						yield* fs.copy(path.join(repo, `.${harness}`, 'skills'), path.join(home, 'skills'))
						if (harness === 'claude') {
							yield* fs.makeDirectory(path.join(home, 'agents'))
							yield* fs.copyFile(path.join(input.root, '.claude/agents/pair.md'), path.join(home, 'agents/pair.md'))
							yield* fs.copyFile(path.join(input.root, '.claude/settings.json'), path.join(home, 'settings.json'))
						} else {
							yield* fs.copyFile(path.join(input.root, '.codex/instructions.md'), path.join(home, 'instructions.md'))
							yield* fs.makeDirectory(path.join(home, 'rules'))
							yield* fs.copyFile(path.join(input.root, '.codex/rules/deny.rules'), path.join(home, 'rules/deny.rules'))
							yield* fs.writeFileString(
								path.join(home, 'config.toml'),
								pipe(
									yield* fs.readFileString(path.join(input.root, '.codex/config.toml')),
									String.replace(
										/^model_instructions_file = .*$/mu,
										`model_instructions_file = "${home}/instructions.md"`
									),
									String.replaceAll(/^\[hooks\.state\."[^"]*\/config\.toml:/gmu, `[hooks.state."${home}/config.toml:`)
								)
							)
							yield* fs.copyFile(path.join(home, 'config.toml'), path.join(repo, '.codex/config.toml'))
						}
						const task = path.join(directory, 'runs', id, 'task.md')
						const criteria = path.join(directory, 'criteria', `${item.id}.md`)
						yield* fs.writeFileString(
							task,
							`Work only in ${repo}. The supplied code was normalized with Oxfmt and lint autofix. Read the supplied ${name} skill before the task. Do not delegate, publish, schedule tasks, change global configuration or load other skills. Keep artifacts under artifacts. Ask only in the final reply and never take a default.\n\n${item.task}\n`
						)
						yield* command(repo, 'vp', ['install', '--frozen-lockfile'])
						yield* command(repo, 'vp', ['check', '--fix'])
						yield* command(repo, 'git', ['init', '-q', '-b', 'main'])
						yield* command(repo, 'git', ['add', '-A'])
						yield* command(repo, 'git', [
							'-c',
							'user.name=Eval',
							'-c',
							'user.email=eval@example.invalid',
							'commit',
							'-qm',
							'Seed evaluation starter'
						])
						if (name === 'review') {
							yield* fs.copyFile(
								path.resolve(import.meta.dirname, '../../starter/review/src/service.ts'),
								path.join(repo, 'src/service.ts')
							)
							yield* command(repo, 'vp', ['check', '--fix'])
						}
						return {
							case: item.id,
							criteria,
							harness,
							home,
							id,
							instance: `eval-${path.basename(directory)}-${id}`,
							repo,
							seed: String.trim(yield* command(repo, 'git', ['rev-parse', 'HEAD'])),
							task
						} satisfies Run
					}),
				{concurrency: 'unbounded'}
			)
		),
		Effect.onExitIf(Exit.isFailure, () => fs.remove(directory, {recursive: true}))
	)
	const manifest = {directory, runs, skill, version: packageJson.version} satisfies Manifest
	yield* fs.writeFileString(
		path.join(directory, 'manifest.json'),
		yield* Schema.encodeEffect(Schema.fromJsonString(Manifest, {space: 2}))(manifest)
	)
	return manifest
})

export const activate = Effect.fn('Evals.activate')(function* (directory: string, id: string, home: string) {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
		yield* fs.readFileString(`${directory}/manifest.json`)
	)
	const selected = Array.findFirst(manifest.runs, run => run.id === id)
	if (Option.isNone(selected)) return yield* EvalError.make({message: `Unknown evaluation run: ${id}`})
	const run = Option.getOrThrow(selected)
	const source = `${home}/.${run.harness}/${harnesses[run.harness].auth}`
	const destination = `${run.home}/${harnesses[run.harness].auth}`
	if (!(yield* fs.exists(source))) return yield* EvalError.make({message: `Missing authentication for ${run.harness}`})
	const linked = Array.contains(yield* fs.readDirectory(run.home), harnesses[run.harness].auth)
	if (linked && (yield* fs.readLink(destination)) !== source) {
		return yield* EvalError.make({message: `Authentication link is not owned by this evaluation: ${id}`})
	}
	const settingsPath = `${home}/.t3/userdata/settings.json`
	const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(yield* fs.readFileString(settingsPath))
	const provider = {
		config: {binaryPath: run.harness, homePath: run.home, launchArgs: harnesses[run.harness].launchArgs(run.home)},
		driver: harnesses[run.harness].driver,
		enabled: true
	}
	const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Settings, {space: 2}))({
		...settings,
		providerInstances: {...settings.providerInstances, [run.instance]: provider}
	})
	yield* Effect.acquireUseRelease(
		Boolean.match(linked, {onFalse: () => fs.symlink(source, destination), onTrue: () => Effect.void}),
		() => fs.writeFileString(settingsPath, encoded),
		(_link, exit) =>
			Boolean.match(linked || Exit.isSuccess(exit), {
				onFalse: () => fs.remove(destination, {force: true}),
				onTrue: () => Effect.void
			})
	)
})

export const cleanup = Effect.fn('Evals.cleanup')(function* (directory: string, home: string, id?: string) {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
		yield* fs.readFileString(`${directory}/manifest.json`)
	)
	const settingsPath = `${home}/.t3/userdata/settings.json`
	const runs = Option.match(Option.fromUndefinedOr(id), {
		onNone: () => manifest.runs,
		onSome: key => Array.filter(manifest.runs, run => run.id === key)
	})
	if (Array.isReadonlyArrayEmpty(runs)) return yield* EvalError.make({message: `Unknown evaluation run: ${id}`})
	yield* pipe(
		Effect.gen(function* () {
			const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(
				yield* fs.readFileString(settingsPath)
			)
			yield* fs.writeFileString(
				settingsPath,
				yield* Schema.encodeEffect(Schema.fromJsonString(Settings, {space: 2}))({
					...settings,
					providerInstances: Record.filter(
						settings.providerInstances,
						(_value, key) => !Array.some(runs, run => run.instance === key)
					)
				})
			)
		}),
		Effect.onExit(() =>
			Effect.forEach(runs, run => fs.remove(`${run.home}/${harnesses[run.harness].auth}`, {force: true}))
		)
	)
})
