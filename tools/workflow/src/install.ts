import {Effect, FileSystem, Path} from 'effect'

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
