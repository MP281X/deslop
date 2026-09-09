import {Array, Effect, FileSystem, Path, Schema} from 'effect'

class InstallError extends Schema.TaggedError<InstallError>()('InstallError', {message: Schema.String}) {}

export const install = Effect.fn('Workflow.install')(function* (source: string, destination: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const targets = [
		{source: 'codex/config.toml', target: 'config.toml'},
		{source: 'AGENTS.md', target: 'AGENTS.md'},
		{source: 'codex/agents', target: 'agents/deslop'},
		{source: 'skills/engineering', target: 'skills/engineering'},
		{source: 'skills/workflow', target: 'skills/workflow'}
	]

	for (const target of targets) {
		yield* fs.access(path.join(source, target.source), {readable: true})
	}

	yield* fs.makeDirectory(destination, {recursive: true})
	const directory = yield* fs.realPath(destination)
	for (const parent of ['agents', 'skills', '.deslop-backups']) {
		const target = path.join(directory, parent)
		if ((yield* fs.exists(target)) && (yield* fs.realPath(target)) !== target) {
			return yield* InstallError.make({message: `Refusing to install through symlink: ${target}`})
		}
		yield* fs.makeDirectory(target, {recursive: true})
	}

	const backupDirectory = yield* fs.makeTempDirectory({
		directory: path.join(directory, '.deslop-backups'),
		prefix: 'install-'
	})
	const stage = yield* fs.makeTempDirectoryScoped({directory, prefix: '.deslop-install-'})
	for (const target of targets) {
		const installed = path.join(directory, target.target)
		const backup = path.join(backupDirectory, target.target)
		const staged = path.join(stage, target.target)
		// Directory entries include broken symlinks, which must also be backed up.
		if (Array.contains(yield* fs.readDirectory(path.dirname(installed)), path.basename(installed))) {
			yield* fs.makeDirectory(path.dirname(backup), {recursive: true})
			yield* fs.copy(installed, backup)
		}
		yield* fs.makeDirectory(path.dirname(staged), {recursive: true})
		yield* fs.copy(path.join(source, target.source), staged)
	}

	for (const target of targets) {
		const installed = path.join(directory, target.target)
		yield* fs.remove(installed, {force: true, recursive: true})
		yield* fs.rename(path.join(stage, target.target), installed)
	}
	return {backupDirectory, directory}
})
