import {NodeServices} from '@effect/platform-node'
import {expect, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, String, pipe} from 'effect'

import {install} from './install.ts'

it.layer(NodeServices.layer)('Workflow installation', test => {
	test.effect('installs the payload, replaces obsolete owned files, and preserves backups and unrelated files', () =>
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

				const first = yield* install(source, destination)
				expect(yield* fs.readFileString(path.join(first.backupDirectory, 'config.toml'))).toBe('previous-config')
				expect(yield* fs.readFileString(path.join(destination, 'config.toml'))).toBe(
					yield* fs.readFileString(path.join(source, 'codex/config.toml'))
				)
				expect(yield* fs.readFileString(path.join(destination, 'AGENTS.md'))).toBe(
					yield* fs.readFileString(path.join(source, 'AGENTS.md'))
				)
				expect(yield* fs.readDirectory(path.join(destination, 'agents/deslop'))).toHaveLength(6)
				yield* fs.writeFileString(path.join(destination, 'skills/engineering/obsolete.md'), 'obsolete')

				const second = yield* install(source, destination)
				expect(yield* fs.exists(path.join(destination, 'skills/engineering/obsolete.md'))).toBe(false)
				expect(yield* fs.readFileString(path.join(second.backupDirectory, 'skills/engineering/obsolete.md'))).toBe(
					'obsolete'
				)
				expect(yield* fs.readDirectory(path.join(destination, '.deslop-backups'))).toHaveLength(2)
				expect(yield* fs.readFileString(path.join(destination, 'auth.json'))).toBe('credentials')
				expect(yield* fs.readFileString(path.join(destination, 'agents/other.toml'))).toBe('unrelated-agent')
				expect(yield* fs.readFileString(path.join(destination, 'skills/unrelated/SKILL.md'))).toBe('unrelated-skill')
			}),
			Effect.scoped
		)
	)

	test.effect('rejects a missing payload before changing the destination', () =>
		pipe(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const destination = path.join(directory, 'codex')
				const result = yield* Effect.exit(install(path.join(directory, 'missing'), destination))
				expect(result._tag).toBe('Failure')
				expect(yield* fs.exists(destination)).toBe(false)
			}),
			Effect.scoped
		)
	)

	test.effect('refuses symlinked managed parents without writing through them', () =>
		pipe(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const source = path.resolve(import.meta.dirname, '../assets')
				const outside = path.join(directory, 'outside')
				yield* fs.makeDirectory(outside)
				for (const parent of ['agents', 'skills', '.deslop-backups']) {
					const destination = path.join(directory, parent)
					yield* fs.makeDirectory(destination)
					yield* fs.writeFileString(path.join(destination, 'config.toml'), 'previous-config')
					yield* fs.symlink(outside, path.join(destination, parent))
					const result = yield* Effect.exit(install(source, destination))
					expect(result._tag).toBe('Failure')
					expect(yield* fs.readFileString(path.join(destination, 'config.toml'))).toBe('previous-config')
				}
				expect(yield* fs.readDirectory(outside)).toEqual([])
			}),
			Effect.scoped
		)
	)

	test.effect('backs up a broken owned symlink and removes staging directories after completion', () =>
		pipe(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const destination = path.join(directory, 'codex')
				yield* fs.makeDirectory(destination)
				const missing = path.join(directory, 'missing-config')
				yield* fs.symlink(missing, path.join(destination, 'config.toml'))
				const result = yield* Effect.scoped(install(path.resolve(import.meta.dirname, '../assets'), destination))
				expect(yield* fs.readLink(path.join(result.backupDirectory, 'config.toml'))).toBe(missing)
				expect(pipe(yield* fs.readDirectory(destination), Array.sort(String.Order))).toEqual([
					'.deslop-backups',
					'AGENTS.md',
					'agents',
					'config.toml',
					'skills'
				])
			}),
			Effect.scoped
		)
	)
})
