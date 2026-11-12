import {Array, Effect, FileSystem, Option, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import type {Edge} from '#map/graph.ts'

type Manifest = typeof Manifest.Type
const Manifest = Schema.Struct({
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	name: Schema.optionalKey(Schema.String),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
})

class CommandError extends Schema.TaggedError<CommandError>()('CommandError', {message: Schema.String}) {}

// A tool's standard output, or its standard error as the failure once it exits non-zero: git, tar and Fallow.
export const output = Effect.fnUntraced(function* (command: string, args: string[]) {
	const handle = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	const result = yield* Effect.all(
		{
			code: handle.exitCode,
			stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
			stdout: Stream.mkString(Stream.decodeText(handle.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (result.code === 0) return result.stdout
	return yield* CommandError.make({message: `${command} ${args[0] ?? ''} failed: ${result.stderr}`})
}, Effect.scoped)

// Fallow's Mermaid output: one `nN["path"]` line per module, then one `nA --> nB` line per import.
function importsOf(mermaid: string) {
	const lines = String.split('\n')(mermaid)
	const names = Record.fromEntries(
		Array.flatMap(lines, line =>
			Option.toArray(
				Option.flatMap(String.match(/^\s*(n\d+)\["(.+)"\]$/u)(line), found =>
					Option.zipWith(
						Option.fromUndefinedOr(found[1]),
						Option.fromUndefinedOr(found[2]),
						(id, file) => [id, file] as const
					)
				)
			)
		)
	)
	return Array.flatMap(lines, line =>
		Option.toArray(
			Option.flatMap(String.match(/^\s*(n\d+) --> (n\d+)$/u)(line), found =>
				Option.zipWith(
					Record.get(names, found[1] ?? ''),
					Record.get(names, found[2] ?? ''),
					(from, to) => ({from, to}) satisfies Edge
				)
			)
		)
	)
}

function workspaceDependencies(manifest: Manifest) {
	return pipe(
		Record.toEntries({...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies}),
		Array.filter(entry => String.startsWith('workspace:')(entry[1])),
		Array.map(entry => entry[0])
	)
}

// pnpm links each workspace dependency into its importer's node_modules; an archive has none, so Fallow resolves no cross-package import without these links.
const linkWorkspace = Effect.fnUntraced(function* (root: string, files: string[]) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const manifests = yield* Effect.forEach(
		Array.filter(files, file => file === 'package.json' || String.endsWith('/package.json')(file)),
		file =>
			Effect.map(
				Effect.flatMap(fs.readFileString(path.join(root, file)), Schema.decodeEffect(Schema.fromJsonString(Manifest))),
				manifest => ({directory: path.dirname(file), manifest})
			),
		{concurrency: 'unbounded'}
	)
	const directories = Record.fromEntries(
		Array.flatMap(manifests, entry =>
			Option.toArray(Option.map(Option.fromUndefinedOr(entry.manifest.name), name => [name, entry.directory] as const))
		)
	)
	yield* Effect.forEach(
		Array.flatMap(manifests, entry =>
			Array.flatMap(workspaceDependencies(entry.manifest), name =>
				Option.toArray(
					Option.map(Record.get(directories, name), target => ({
						link: path.join(root, entry.directory, 'node_modules', name),
						target: path.join(root, target)
					}))
				)
			)
		),
		found =>
			Effect.andThen(
				fs.makeDirectory(path.dirname(found.link), {recursive: true}),
				fs.symlink(found.target, found.link)
			),
		{concurrency: 'unbounded', discard: true}
	)
})

// A revision's tracked files in a scoped temporary directory, apart from the working tree, with the module imports Fallow resolves between them; the stash binaries stay out, since no module reads them.
export const treeOf = Effect.fnUntraced(function* (revision: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-map-'})
	const archive = path.join(root, '.map.tar')
	yield* output('git', ['archive', '--output', archive, revision, '--', '.', ':(exclude,glob)**/*.zst'])
	yield* output('tar', ['-xf', archive, '-C', root])
	yield* fs.remove(archive)
	const files = Array.filter(
		String.split('\n')(yield* output('git', ['ls-tree', '-r', '--name-only', revision])),
		String.isNonEmpty
	)
	yield* linkWorkspace(root, files)
	const graph = path.join(root, '.map.mmd')
	yield* output('fallow', [
		'viz',
		'--root',
		root,
		'--viz-format',
		'mermaid',
		'--out',
		graph,
		'--no-open',
		'--no-cache',
		'--quiet'
	])
	return {
		files,
		imports: importsOf(yield* fs.readFileString(graph)),
		read: (file: string) => Effect.option(fs.readFileString(path.join(root, file)))
	}
})

export type Tree = Effect.Success<ReturnType<typeof treeOf>>
