import {NodeServices} from '@effect/platform-node'
import {expect, it} from '@effect/vitest'

import {Effect, FileSystem, Path, pipe} from 'effect'

import {install} from './install.ts'

it.layer(NodeServices.layer)('Workflow installation', test => {
	test.effect('installs and reinstalls owned files while preserving unrelated files', () =>
		pipe(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const destination = path.join(directory, 'codex home')
				const source = path.resolve(import.meta.dirname, '../assets')
				yield* fs.makeDirectory(path.join(destination, 'agents'), {recursive: true})
				yield* fs.makeDirectory(path.join(destination, 'skills/unrelated'), {recursive: true})
				yield* fs.writeFileString(path.join(destination, 'config.toml'), 'previous-config')
				yield* fs.writeFileString(path.join(destination, 'auth.json'), 'credentials')
				yield* fs.writeFileString(path.join(destination, 'agents/other.toml'), 'unrelated-agent')
				yield* fs.writeFileString(path.join(destination, 'skills/unrelated/SKILL.md'), 'unrelated-skill')

				yield* install(source, destination)
				expect(yield* fs.readFileString(path.join(destination, 'config.toml'))).toBe(
					yield* fs.readFileString(path.join(source, 'codex/config.toml'))
				)
				expect(yield* fs.readFileString(path.join(destination, 'AGENTS.md'))).toBe(
					yield* fs.readFileString(path.join(source, 'AGENTS.md'))
				)
				expect(yield* fs.readDirectory(path.join(destination, 'agents/deslop'))).toHaveLength(6)
				yield* fs.writeFileString(path.join(destination, 'agents/deslop/obsolete.toml'), 'obsolete')
				yield* fs.writeFileString(path.join(destination, 'skills/engineering/obsolete.md'), 'obsolete')
				yield* fs.writeFileString(path.join(destination, 'skills/workflow/obsolete.md'), 'obsolete')

				yield* install(source, destination)
				expect(yield* fs.exists(path.join(destination, 'agents/deslop/obsolete.toml'))).toBe(false)
				expect(yield* fs.exists(path.join(destination, 'skills/engineering/obsolete.md'))).toBe(false)
				expect(yield* fs.exists(path.join(destination, 'skills/workflow/obsolete.md'))).toBe(false)
				expect(yield* fs.readFileString(path.join(destination, 'auth.json'))).toBe('credentials')
				expect(yield* fs.readFileString(path.join(destination, 'agents/other.toml'))).toBe('unrelated-agent')
				expect(yield* fs.readFileString(path.join(destination, 'skills/unrelated/SKILL.md'))).toBe('unrelated-skill')
			}),
			Effect.scoped
		)
	)
})
