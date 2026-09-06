import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, FileSystem, Path, pipe} from 'effect'

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const source = path.resolve(import.meta.dirname, '../.agents')
	const destination = '/home/mp281x/.codex'

	for (const entry of [
		{source: 'config.toml', target: 'config.toml'},
		{source: 'AGENTS.md', target: 'AGENTS.md'},
		{source: 'roles', target: 'agents'},
		{source: 'skills/engineering', target: 'skills/engineering'},
		{source: 'skills/workflow', target: 'skills/workflow'}
	]) {
		const target = path.join(destination, entry.target)
		yield* fs.remove(target, {force: true, recursive: true})
		yield* fs.makeDirectory(path.dirname(target), {recursive: true})
		yield* fs.copy(path.join(source, entry.source), target)
	}
})

// This executable assembles its complete platform layer at the entry point.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(pipe(program, Effect.provide(NodeServices.layer)))
