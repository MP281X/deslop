import {Array, Effect, FileSystem, Option, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import packageJson from '#package' with {type: 'json'}
import {EvalCase, EvalError, Manifest} from '#schema'
import type {Run} from '#schema'

export type Settings = typeof Settings.Type
export const Settings = Schema.StructWithRest(
	Schema.Struct({providerInstances: Schema.Record(Schema.String, Schema.Unknown)}),
	[Schema.Record(Schema.String, Schema.Unknown)]
)

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
	home: string
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
	for (const file of files) {
		const target = path.join(input.home, file)
		yield* fs.makeDirectory(path.dirname(target), {recursive: true})
		if (file === '.codex/config.toml') {
			yield* fs.writeFileString(
				target,
				pipe(
					yield* fs.readFileString(path.join(input.root, file)),
					String.replace(
						/^model_instructions_file = .*$/mu,
						`model_instructions_file = "${path.join(input.home, '.codex/instructions.md')}"`
					)
				)
			)
		} else {
			yield* fs.copyFile(path.join(input.root, file), target)
		}
	}
	const directory = yield* fs.makeTempDirectory({prefix: 'deslop-evals-'})
	const starter = path.resolve(import.meta.dirname, '../../starter/importer')
	const runs = Array.flatten(
		yield* Effect.forEach(cases, item =>
			Effect.forEach(input.harnesses, harness =>
				Effect.gen(function* () {
					const id = `${item.id}-${harness}`
					const home = path.join(directory, 'homes', id)
					const repo = path.join(directory, 'runs', id, 'repo')
					yield* fs.makeDirectory(home, {recursive: true})
					yield* fs.makeDirectory(repo, {recursive: true})
					const sources = [
						starter,
						...(name === 'testing' ? [path.resolve(import.meta.dirname, '../../starter/folder-import')] : [])
					]
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
						yield* fs.copyFile(path.join(input.home, file), path.join(repo, file))
					}
					yield* fs.copy(
						path.join(repo, harness === 'claude' ? '.claude' : '.codex', 'skills'),
						path.join(home, 'skills')
					)
					if (harness === 'claude') {
						yield* fs.makeDirectory(path.join(home, 'agents'))
						yield* fs.copyFile(path.join(input.home, '.claude/agents/pair.md'), path.join(home, 'agents/pair.md'))
						yield* fs.copyFile(path.join(input.home, '.claude/settings.json'), path.join(home, 'settings.json'))
						yield* fs.symlink(path.join(input.home, '.claude/.credentials.json'), path.join(home, '.credentials.json'))
					} else {
						yield* fs.copyFile(path.join(input.home, '.codex/instructions.md'), path.join(home, 'instructions.md'))
						yield* fs.makeDirectory(path.join(home, 'rules'))
						yield* fs.copyFile(path.join(input.home, '.codex/rules/deny.rules'), path.join(home, 'rules/deny.rules'))
						yield* fs.writeFileString(
							path.join(home, 'config.toml'),
							pipe(
								yield* fs.readFileString(path.join(input.home, '.codex/config.toml')),
								String.replace(
									/^model_instructions_file = .*$/mu,
									`model_instructions_file = "${home}/instructions.md"`
								)
							)
						)
						yield* fs.copyFile(path.join(home, 'config.toml'), path.join(repo, '.codex/config.toml'))
						yield* fs.symlink(path.join(input.home, '.codex/auth.json'), path.join(home, 'auth.json'))
					}
					const task = path.join(directory, 'runs', id, 'task.md')
					const criteria = path.join(directory, 'criteria', `${item.id}.md`)
					yield* fs.makeDirectory(path.dirname(criteria), {recursive: true})
					yield* fs.writeFileString(criteria, item.criteria)
					yield* fs.writeFileString(
						task,
						`Work only in ${repo}. Read the supplied ${name} skill before the task. Do not delegate, publish, schedule tasks, change global configuration or load other skills. Keep artifacts under artifacts. Ask only in the final reply and never take a default.\n\n${item.task}\n`
					)
					yield* command(repo, 'vp', ['install', '--frozen-lockfile'])
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
						task,
						threadId: Option.getOrNull(Option.none())
					} satisfies Run
				})
			)
		)
	)
	const manifest = {directory, runs, skill, version: packageJson.version} satisfies Manifest
	yield* fs.writeFileString(
		path.join(directory, 'manifest.json'),
		yield* Schema.encodeEffect(Schema.fromJsonString(Manifest, {space: 2}))(manifest)
	)
	const settingsPath = path.join(input.home, '.t3/userdata/settings.json')
	const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(yield* fs.readFileString(settingsPath))
	const providers = Record.fromEntries(
		Array.map(runs, run => [
			run.instance,
			{
				config: {
					binaryPath: run.harness,
					homePath: run.home,
					launchArgs:
						run.harness === 'claude'
							? `--system-prompt-snapshot off --agent pair --settings ${run.home}/settings.json`
							: `-c model_instructions_file=${run.home}/instructions.md`
				},
				driver: run.harness === 'claude' ? 'claudeAgent' : 'codex',
				enabled: true
			}
		])
	)
	yield* fs.writeFileString(
		settingsPath,
		yield* Schema.encodeEffect(Schema.fromJsonString(Settings, {space: 2}))({
			...settings,
			providerInstances: {...settings.providerInstances, ...providers}
		})
	)
	return manifest
})

export const cleanup = Effect.fn('Evals.cleanup')(function* (directory: string, home: string) {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
		yield* fs.readFileString(`${directory}/manifest.json`)
	)
	const settingsPath = `${home}/.t3/userdata/settings.json`
	const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(yield* fs.readFileString(settingsPath))
	yield* fs.writeFileString(
		settingsPath,
		yield* Schema.encodeEffect(Schema.fromJsonString(Settings, {space: 2}))({
			...settings,
			providerInstances: Record.filter(
				settings.providerInstances,
				(_value, id) => !Array.some(manifest.runs, run => run.instance === id)
			)
		})
	)
	for (const run of manifest.runs) {
		yield* fs.remove(`${run.home}/${run.harness === 'claude' ? '.credentials.json' : 'auth.json'}`, {force: true})
	}
})
