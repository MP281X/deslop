import {Array, Boolean, Effect, Graph, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import {matches} from '#lib/ast.ts'
import type {Facts} from '#map/facts.ts'
import {ITEM, factsOf, lockedVersions, settings} from '#map/facts.ts'
import type {Edge} from '#map/graph.ts'
import {
	ROOT,
	areasOf,
	isCode,
	isTest,
	moduleDiagram,
	moveDiagram,
	packageDiagram,
	packageOf,
	serviceDiagram
} from '#map/graph.ts'
import type {Change, Move} from '#map/moves.ts'
import {classify, surplus} from '#map/moves.ts'
import type {Tree} from '#map/tree.ts'
import {output, treeOf} from '#map/tree.ts'

const RUNTIME = 'packages/runtime'

export type Delta = 'added' | 'changed' | 'removed'

type Suppression = {line: number; text: string}

const isGenerated = matches(/(?:^|\/)pnpm-lock\.yaml$|\.gen\.[cm]?[jt]sx?$/u)

const isSchemaModule = matches(/(?:^|\/)schema\.ts$/u)

const isSettings = matches(
	/(?:^|\/)(?:package\.json|vite\.config\.ts|tsconfig[^/]*\.json|\.fallowrc\.jsonc?)$|^tools\/coding-standards\/src\/lint\.ts$/u
)

const isConfiguration = matches(
	/^tools\/coding-standards\/src\/lint\/|^\.github\/workflows\/|^pnpm-workspace\.yaml$|\.oxlintrc/u
)

// `git diff -z --numstat`: `added removed path` per file, or `added removed` then the old and new paths of a rename.
function changesOf(tokens: string[]): Change[] {
	return Option.match(Array.head(tokens), {
		onNone: () => [],
		onSome: token =>
			Option.match(String.match(/^(\d+|-)\t(\d+|-)\t(.*)$/su)(token), {
				onNone: () => changesOf(Array.drop(tokens, 1)),
				onSome: found => {
					const counts = {
						added: Option.getOrElse(Number.parse(found[1] ?? ''), () => 0),
						removed: Option.getOrElse(Number.parse(found[2] ?? ''), () => 0)
					}
					const file = found[3] ?? ''
					if (file !== '') return [{...counts, file, from: file}, ...changesOf(Array.drop(tokens, 1))]
					return [{...counts, file: tokens[2] ?? '', from: tokens[1] ?? ''}, ...changesOf(Array.drop(tokens, 3))]
				}
			})
	})
}

function delta<A>(before: Option.Option<A>, after: Option.Option<A>, same: (first: A, second: A) => boolean) {
	return Option.match(before, {
		onNone: () => Option.some<Delta>('added'),
		onSome: previous =>
			Option.match(after, {
				onNone: () => Option.some<Delta>('removed'),
				onSome: next => Option.filter(Option.some<Delta>('changed'), () => !same(previous, next))
			})
	})
}

function keyedDelta(before: Record<string, string>, after: Record<string, string>) {
	return pipe(
		[...Record.keys(before), ...Record.keys(after)],
		Array.dedupe,
		Array.sort(String.Order),
		Array.flatMap(key =>
			Option.toArray(
				Option.map(
					delta(Record.get(before, key), Record.get(after, key), (first, second) => first === second),
					change => ({
						after: Option.getOrUndefined(Record.get(after, key)),
						before: Option.getOrUndefined(Record.get(before, key)),
						change,
						key
					})
				)
			)
		)
	)
}

function commitOf(revision: string) {
	return Effect.map(output('git', ['rev-parse', '--verify', `${revision}^{commit}`]), String.trim)
}

// Every module of a touched package and of the shared runtime: schemas, contracts and services reach across files.
const factsIn = Effect.fnUntraced(function* (tree: Tree, owners: string[]) {
	const read = yield* Effect.forEach(
		Array.filter(
			tree.files,
			file =>
				isCode(file) && !isGenerated(file) && (Array.contains(owners, packageOf(file)) || packageOf(file) === RUNTIME)
		),
		file => Effect.map(tree.read(file), source => Option.map(source, text => [file, factsOf(file, text)] as const)),
		{concurrency: 'unbounded'}
	)
	return Record.fromEntries(Array.getSomes(read))
})

// A package's own modules; its tests declare stand-ins, not the package's contracts, routes or providers.
function factsOfPackage(facts: Record<string, Facts>, owner: string) {
	return Array.map(
		Array.filter(Record.toEntries(facts), entry => packageOf(entry[0]) === owner && !isTest(entry[0])),
		entry => entry[1]
	)
}

// The package's and the runtime's `schema.ts` modules, where every schema a contract or a store holds is declared.
function schemaFacts(facts: Record<string, Facts>, owner: string) {
	return Array.map(
		Array.filter(
			Record.toEntries(facts),
			entry => isSchemaModule(entry[0]) && Array.contains([owner, RUNTIME], packageOf(entry[0]))
		),
		entry => entry[1]
	)
}

// The names reachable from the roots through the top-level declarations that read them.
function reach(facts: Facts[], roots: string[]) {
	const declarations = Array.flatMap(facts, found => found.declarations)
	const graph = Graph.directed<string, 'reads'>(mutable => {
		const indices = Record.fromEntries(
			Array.map(
				Array.dedupe(Array.map(declarations, found => found.name)),
				name => [name, Graph.addNode(mutable, name)] as const
			)
		)
		for (const found of declarations) {
			for (const name of found.names) {
				Option.zipWith(Record.get(indices, found.name), Record.get(indices, name), (source, target) =>
					Graph.addEdge(mutable, source, target, 'reads')
				)
			}
		}
	})
	return Array.fromIterable(
		Graph.values(
			Graph.dfs(graph, {start: Array.getSomes(Array.map(roots, root => Graph.findNode(graph, name => name === root)))})
		)
	)
}

function suppressionsOf(source: Option.Option<string>) {
	return Array.flatMap(String.split('\n')(Option.getOrElse(source, () => '')), (line, index) =>
		Option.toArray(
			Option.map(
				String.match(
					/(?:\/\/|\/\*)\s*((?:oxlint|eslint)-(?:disable|enable)[\w-]*|@ts-(?:ignore|expect-error|nocheck)|fallow-ignore[\w-]*|@effect-diagnostics[\w-]*|judge-ignore)\b(.*?)(?:\*\/)?\s*$/u
				)(line),
				found => ({line: index + 1, text: String.trim(`${found[1] ?? ''}${found[2] ?? ''}`)}) satisfies Suppression
			)
		)
	)
}

function linesOf(source: Option.Option<string>) {
	return Array.map(String.split('\n')(Option.getOrElse(source, () => '')), (text, index) => ({line: index + 1, text}))
}

function baseName(file: string) {
	return String.replace(/\..*$/u, '')(String.replace(/^.*\//u, '')(file))
}

// What a reader calls a changed file: its package, a file name no other package has, and the exports it changed.
function termsOf(file: string, files: string[], exports: {file: string; names: {name: string}[]}[]) {
	const owners = Array.dedupe(
		Array.map(
			Array.filter(files, other => isCode(other) && baseName(other) === baseName(file)),
			packageOf
		)
	)
	return pipe(
		[
			...Array.filter([baseName(packageOf(file))], () => packageOf(file) !== ROOT),
			...Array.filter([baseName(file)], () => isCode(file) && owners.length === 1),
			...pipe(
				exports,
				Array.filter(entry => entry.file === file),
				Array.flatMap(entry => Array.map(entry.names, found => found.name))
			)
		],
		Array.map(term => String.toLowerCase(term)),
		Array.filter(term => term.length >= 3 && term !== 'default')
	)
}

// A TanStack or Expo Router file's path: groups, `index` and `route` add no segment, and a dot nests.
function pageRoute(file: string) {
	return `/${pipe(
		file,
		String.replace(/^apps\/[^/]+\/src\/routes\/?/u, ''),
		String.replace(/\.tsx$/u, ''),
		String.replaceAll(/(?:^|\/)\([^)]*\)/gu, ''),
		String.replace(/(?:^|\/)(?:index|route)$/u, ''),
		String.replaceAll('.', '/'),
		String.replace(/^\//u, '')
	)}`
}

function routesOf(facts: Record<string, Facts>, files: string[], owner: string) {
	return [
		...Array.flatMap(factsOfPackage(facts, owner), found => found.routes),
		...Array.map(
			// A `-` prefix keeps a file out of the route tree; `__root` and `_layout` wrap routes without a path.
			Array.filter(
				files,
				file =>
					packageOf(file) === owner && matches(/^apps\/[^/]+\/src\/routes\/(?:[^/-][^/]*\/)*[^/_-][^/]*\.tsx$/u)(file)
			),
			file => `page ${pageRoute(file)}`
		)
	]
}

function contractsOf(facts: Record<string, Facts>, owner: string) {
	return Record.fromEntries(
		Array.map(
			Array.flatMap(factsOfPackage(facts, owner), found => found.contracts),
			contract => [`${contract.kind} ${contract.name}`, contract] as const
		)
	)
}

function storedOf(facts: Record<string, Facts>, owner: string) {
	return reach(
		schemaFacts(facts, owner),
		Array.flatMap(factsOfPackage(facts, owner), found => found.stored)
	)
}

function exportsOf(facts: Option.Option<Facts>) {
	return Option.getOrElse(
		Option.map(facts, found => found.exports),
		() => ({})
	)
}

const versionsOf = Effect.fnUntraced(function* (tree: Tree) {
	return lockedVersions(Option.getOrElse(yield* tree.read('pnpm-lock.yaml'), () => ''))
})

const settingsOf = Effect.fnUntraced(function* (tree: Tree, file: string) {
	return Option.match(yield* tree.read(file), {onNone: () => ({}), onSome: source => settings(file, source)})
})

// The object in a list a setting belongs to, such as `boundaries.zones[shared]`.
function elementOf(key: string) {
	return Option.flatMap(String.match(/^(.*\])/u)(Array.headNonEmpty(String.split(ITEM)(key))), found =>
		Option.fromUndefinedOr(found[1])
	)
}

function hasPrefix(values: Record<string, string>, prefix: string) {
	return Array.some(Record.keys(values), key => String.startsWith(prefix)(key))
}

// An object's settings as `patterns: a, b`, without the one that names it.
function fieldsOf(values: Record<string, string>, prefix: string) {
	return pipe(
		Record.toEntries(values),
		Array.filter(
			entry =>
				String.startsWith(prefix)(entry[0]) &&
				(String.includes(ITEM)(entry[0]) || !String.endsWith(`[${entry[1]}]`)(prefix))
		),
		Array.groupBy(entry =>
			String.replace(/^\./u, '')(Array.headNonEmpty(String.split(ITEM)(String.slice(prefix.length)(entry[0]))))
		),
		Record.toEntries,
		Array.map(
			entry =>
				`${entry[0]}: ${Array.join(
					Array.map(entry[1], found => found[1]),
					', '
				)}`
		)
	)
}

// Each changed setting the way a person says it: an object added to or removed from a list as one line, a list's items as what it gained and lost.
function settingLines(
	before: Record<string, string>,
	after: Record<string, string>,
	ignored: (key: string) => boolean
) {
	const changed = Array.filter(keyedDelta(before, after), setting => !ignored(setting.key))
	const elements = pipe(
		changed,
		Array.flatMap(setting => Option.toArray(elementOf(setting.key))),
		Array.dedupe,
		Array.flatMap(element => {
			if (!hasPrefix(before, element)) {
				return [{change: 'added' as const, fields: fieldsOf(after, element), key: element, kind: 'element' as const}]
			}
			if (!hasPrefix(after, element)) {
				return [{change: 'removed' as const, fields: fieldsOf(before, element), key: element, kind: 'element' as const}]
			}
			return []
		})
	)
	const rest = Array.filter(
		changed,
		setting => !Option.exists(elementOf(setting.key), element => Array.some(elements, line => line.key === element))
	)
	const items = pipe(
		Array.filter(rest, setting => String.includes(ITEM)(setting.key)),
		Array.groupBy(setting => Array.headNonEmpty(String.split(ITEM)(setting.key))),
		Record.toEntries,
		Array.map(entry => ({
			added: Array.getSomes(
				Array.map(
					Array.filter(entry[1], setting => setting.change === 'added'),
					setting => Option.fromUndefinedOr(setting.after)
				)
			),
			key: entry[0],
			kind: 'items' as const,
			removed: Array.getSomes(
				Array.map(
					Array.filter(entry[1], setting => setting.change === 'removed'),
					setting => Option.fromUndefinedOr(setting.before)
				)
			)
		}))
	)
	// Three or more keys one object gained or lost read as a list of their names, such as the rules a preset dropped.
	const keyed = pipe(
		rest,
		Array.filter(setting => !String.includes(ITEM)(setting.key) && setting.change !== 'changed'),
		Array.groupBy(setting => String.replace(/\.[^.]*$/u, '')(setting.key)),
		Record.toEntries,
		Array.filter(entry => entry[1].length >= 3),
		Array.map(entry => ({
			added: Array.map(
				Array.filter(entry[1], setting => setting.change === 'added'),
				setting => String.slice(entry[0].length + 1)(setting.key)
			),
			key: entry[0],
			kind: 'items' as const,
			removed: Array.map(
				Array.filter(entry[1], setting => setting.change === 'removed'),
				setting => String.slice(entry[0].length + 1)(setting.key)
			)
		}))
	)
	return pipe(
		[
			...elements,
			...items,
			...keyed,
			...Array.map(
				Array.filter(
					rest,
					setting =>
						!String.includes(ITEM)(setting.key) &&
						!Array.some(
							keyed,
							line => setting.change !== 'changed' && String.replace(/\.[^.]*$/u, '')(setting.key) === line.key
						)
				),
				setting => ({...setting, kind: 'value' as const})
			)
		],
		Array.sortWith(line => line.key, String.Order)
	)
}

export type SettingLine = ReturnType<typeof settingLines>[number]

// A configuration file's settings that changed; a rule's source, a workflow or the workspace file is listed whole. A manifest's dependencies are the lockfile's to report, and its export map is a contract of its own.
const configOf = Effect.fnUntraced(function* (before: Tree, after: Tree, change: Change) {
	const entry = {
		change: Option.getOrElse(
			delta(
				Option.liftPredicate(change.from, path => Array.contains(before.files, path)),
				Option.liftPredicate(change.file, path => Array.contains(after.files, path)),
				() => false
			),
			() => 'changed' as const
		),
		file: change.file
	}
	if (!isSettings(change.file)) return [{...entry, kind: 'file' as const, settings: []}]
	const lines = settingLines(
		yield* settingsOf(before, change.from),
		yield* settingsOf(after, change.file),
		matches(/^(?:(?:d|devD|optionalD|peerD)ependencies|exports)\./u)
	)
	if (!Array.isReadonlyArrayNonEmpty(lines)) return []
	return [{...entry, kind: 'settings' as const, settings: lines}]
})

// A manifest's `exports`; a package without the file or the field exports nothing.
const exportsIn = Effect.fnUntraced(function* (tree: Tree, file: string) {
	return yield* Option.match(yield* tree.read(file), {
		onNone: () => Effect.succeed<Record<string, string>>({}),
		onSome: source =>
			Effect.map(
				Schema.decodeEffect(
					Schema.fromJsonString(
						Schema.Struct({exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))})
					)
				)(source),
				manifest => manifest.exports ?? {}
			)
	})
})

// Each specifier an export map serves, with its file: a `*` entry serves every file its target matches.
function served(directory: string, entries: Record<string, string>, files: readonly string[]) {
	return pipe(
		Record.toEntries(entries),
		Array.flatMap(entry => {
			const target = `${directory}/${String.replace(/^\.\//u, '')(entry[1])}`
			return Option.match(String.match(/^([^*]*)\*(.*)$/u)(target), {
				onNone: () =>
					Array.filter([{entry: entry[0], file: target, specifier: entry[0]}], () => Array.contains(files, target)),
				onSome: found => {
					const head = found[1] ?? ''
					const tail = found[2] ?? ''
					return Array.flatMap(files, file => {
						if (
							!String.startsWith(head)(file) ||
							!String.endsWith(tail)(file) ||
							file.length <= head.length + tail.length
						) {
							return []
						}
						return [
							{
								entry: entry[0],
								file,
								specifier: String.replace('*', String.slice(head.length, file.length - tail.length)(file))(entry[0])
							}
						]
					})
				}
			})
		}),
		Array.dedupeWith((first, second) => first.specifier === second.specifier)
	)
}

// A package's export map before and after, read as what each old specifier became: the file it served is followed through its move to the specifier that serves it now.
const exportMapOf = Effect.fnUntraced(function* (
	before: Tree,
	after: Tree,
	change: Change,
	moved: (file: string) => string
) {
	const directory = String.replace(/\/package\.json$/u, '')(change.file)
	const previous = yield* exportsIn(before, change.from)
	const next = yield* exportsIn(after, change.file)
	const entries = keyedDelta(previous, next)
	if (!Array.isReadonlyArrayNonEmpty(entries)) return []
	const was = served(directory, previous, before.files)
	const is = served(directory, next, after.files)
	return [
		{
			after: Record.size(next),
			before: Record.size(previous),
			entries,
			// Newly importable modules, tests aside.
			exposed: Array.filter(
				is,
				found => !isTest(found.file) && !Array.some(was, old => moved(old.file) === found.file)
			),
			// Specifiers that still reach the same module through another entry.
			kept: Array.filter(is, found =>
				Array.some(
					was,
					old => old.specifier === found.specifier && moved(old.file) === found.file && old.entry !== found.entry
				)
			),
			owner: directory,
			renamed: Array.flatMap(was, old => {
				const file = moved(old.file)
				if (Array.some(is, found => found.specifier === old.specifier && found.file === file)) return []
				return [{from: old.specifier, to: Array.filter(is, found => found.file === file)}]
			})
		}
	]
})

// The lockfile's direct dependencies of every importer, one line per dependency and version change.
const dependenciesOf = Effect.fnUntraced(function* (before: Tree, after: Tree, changes: Change[]) {
	if (!Array.some(changes, change => change.file === 'pnpm-lock.yaml')) return []
	return pipe(
		keyedDelta(yield* versionsOf(before), yield* versionsOf(after)),
		Array.groupBy(entry => `${String.replace(/^\S+ /u, '')(entry.key)} ${entry.before ?? ''} ${entry.after ?? ''}`),
		Record.values,
		Array.map(group => ({
			after: Array.headNonEmpty(group).after,
			before: Array.headNonEmpty(group).before,
			change: Array.headNonEmpty(group).change,
			importers: Array.map(group, entry => String.replace(/ \S+$/u, '')(entry.key)),
			name: String.replace(/^\S+ /u, '')(Array.headNonEmpty(group).key)
		})),
		Array.sortWith(entry => entry.name, String.Order)
	)
})

// An app's own providers, and every service class it or the runtime declares for them to yield.
function providersOf(facts: Record<string, Facts>, owner: string) {
	return {
		providers: Array.flatMap(factsOfPackage(facts, owner), found => found.providers),
		services: pipe(
			[...factsOfPackage(facts, owner), ...factsOfPackage(facts, RUNTIME)],
			Array.flatMap(found => found.providers),
			Array.filter(provider => provider.service),
			Array.map(provider => provider.name)
		)
	}
}

function servicesOf(before: Record<string, Facts>, after: Record<string, Facts>, owner: string) {
	const found = serviceDiagram(providersOf(before, owner), providersOf(after, owner))
	if (
		Option.isNone(found.diagram) &&
		!Array.isReadonlyArrayNonEmpty(found.bundles) &&
		!Array.isReadonlyArrayNonEmpty(found.edited)
	) {
		return Option.none()
	}
	return Option.some({...found, owner})
}

// Suppressions one side added and the other removed with the same text moved with their code: no change.
function movedApart<A extends {change: 'added' | 'removed'; file: string; line: number; text: string}>(
	perFile: readonly (readonly A[])[]
) {
	const all = Array.flatten(perFile)
	const added = Array.filter(all, entry => entry.change === 'added')
	const removed = Array.filter(all, entry => entry.change === 'removed')
	return Array.sortWith(
		[...surplus(added, removed, entry => entry.text), ...surplus(removed, added, entry => entry.text)],
		entry => `${entry.file}:${String.padStart(6, '0')(`${entry.line}`)}`,
		String.Order
	)
}

function schemaNames(facts: Record<string, Facts>, file: string) {
	return Option.getOrElse(
		Option.map(Record.get(facts, file), found => found.schemas),
		() => []
	)
}

// Where each before path lives after the change: a renamed file at its new path, a deleted file at the file most of its declarations moved to.
function movedPaths(changes: readonly Change[], moves: readonly Move[], after: Tree) {
	const renamed = Record.fromEntries(
		Array.map(
			Array.filter(changes, change => change.from !== change.file),
			change => [change.from, change.file] as const
		)
	)
	const emptied = pipe(
		changes,
		Array.filter(change => change.from === change.file && !Array.contains(after.files, change.file)),
		Array.flatMap(change => {
			const targets = Record.toEntries(
				Array.groupBy(
					Array.filter(moves, move => move.from === change.file),
					move => move.to
				)
			)
			if (!Array.isReadonlyArrayNonEmpty(targets)) return []
			const most = Array.max(
				targets,
				Order.mapInput(Number.Order, (entry: readonly [string, readonly Move[]]) => entry[1].length)
			)
			return [[change.file, most[0]] as const]
		}),
		Record.fromEntries
	)
	return (file: string) =>
		Option.getOrElse(
			Option.orElse(Record.get(renamed, file), () => Record.get(emptied, file)),
			() => file
		)
}

// The change between two commits as facts read from both revisions' code, never from the diff's wording.
export const mapOf = Effect.fnUntraced(function* (base: Option.Option<string>, headRevision: string) {
	const head = yield* commitOf(headRevision)
	const from = yield* Option.match(base, {
		onNone: () =>
			Effect.flatMap(output('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']), main =>
				Effect.map(output('git', ['merge-base', String.trim(main), head]), String.trim)
			),
		onSome: commitOf
	})
	const changes = Array.filter(
		changesOf(String.split('\0')(yield* output('git', ['diff', '-z', '-M', '--numstat', from, head]))),
		change => change.file !== ''
	)
	const [before, after] = yield* Effect.all([treeOf(from), treeOf(head)], {concurrency: 'unbounded'})
	const authored = Array.filter(changes, change => !isGenerated(change.file))
	const owners = Array.dedupe(Array.flatMap(changes, change => [packageOf(change.file), packageOf(change.from)]))
	const [beforeFacts, afterFacts] = yield* Effect.all([factsIn(before, owners), factsIn(after, owners)], {
		concurrency: 'unbounded'
	})
	const classified = classify(authored, beforeFacts, afterFacts)
	const moved = movedPaths(authored, classified.moves, after)
	// The before revision in the after revision's paths, so a module that only moved brings no import change with it.
	const translated = {
		files: Array.dedupe(Array.map(before.files, moved)),
		imports: Array.map(before.imports, edge => ({from: moved(edge.from), to: moved(edge.to)}) satisfies Edge)
	}
	// A file whose code is unchanged, in place or renamed, uses the same declarations wherever they moved: its imports before are the ones it has now.
	const followers = pipe(
		classified.files,
		Array.filter(
			file =>
				(file.kind === 'imports' || (file.kind === 'moved' && file.from !== file.file)) &&
				!Array.some(classified.moves, move => move.to === file.file || move.from === file.from)
		),
		Array.map(file => file.file)
	)
	const settled = {
		files: translated.files,
		imports: [
			...Array.filter(translated.imports, edge => !Array.contains(followers, edge.from)),
			...Array.filter(after.imports, edge => Array.contains(followers, edge.from))
		]
	}
	const code = Array.filter(authored, change => isCode(change.file) || isCode(change.from))
	function isMovedName(change: Change, name: string, side: 'from' | 'to') {
		return Array.some(
			classified.moves,
			move =>
				move.name === name &&
				Boolean.match(side === 'from', {
					onFalse: () => move.to === change.file,
					onTrue: () => move.from === change.from
				})
		)
	}
	// Exports a file added, removed or edited in place; one that moved is the moves' to report.
	const exports = Array.filter(
		Array.map(code, change => ({
			file: change.file,
			names: Array.flatMap(
				keyedDelta(exportsOf(Record.get(beforeFacts, change.from)), exportsOf(Record.get(afterFacts, change.file))),
				entry => {
					if (entry.change === 'removed' && isMovedName(change, entry.key, 'from')) return []
					if (entry.change === 'added' && isMovedName(change, entry.key, 'to')) return []
					return [{change: entry.change, name: entry.key}]
				}
			)
		})),
		entry => Array.isReadonlyArrayNonEmpty(entry.names)
	)
	const schemas = [
		...Array.flatMap(code, change =>
			pipe(
				exports,
				Array.filter(entry => entry.file === change.file),
				Array.flatMap(entry => entry.names),
				Array.filter(found =>
					Array.contains(
						[...schemaNames(beforeFacts, change.from), ...schemaNames(afterFacts, change.file)],
						found.name
					)
				),
				Array.map(found => ({...found, file: change.file, movedFrom: ''}))
			)
		),
		// A schema edited on its way to another file changed shape where its readers now find it.
		...Array.map(
			Array.filter(
				classified.moves,
				move => move.edited && Array.contains(schemaNames(afterFacts, move.to), move.name)
			),
			move => ({change: 'changed' as const, file: move.to, movedFrom: move.from, name: move.name})
		)
	]
	const lines = Record.fromEntries(Array.map(classified.files, file => [file.file, file.lines] as const))
	const edited = Array.filter(classified.files, file => file.kind === 'edited')
	const areas = Array.filter(
		areasOf(
			yield* Effect.forEach(
				Array.filter(authored, change => !isSettings(change.file) && !isConfiguration(change.file)),
				change =>
					Effect.map(
						Effect.all([before.read(change.from), after.read(change.file)], {concurrency: 'unbounded'}),
						pair => ({
							file: change.file,
							lines: Option.getOrElse(Record.get(lines, change.file), () => 0),
							terms: termsOf(change.file, after.files, exports),
							words: Boolean.match(packageOf(change.file) === ROOT, {
								onFalse: () => [],
								onTrue: () =>
									pipe(
										[
											...surplus(linesOf(pair[1]), linesOf(pair[0]), line => line.text),
											...surplus(linesOf(pair[0]), linesOf(pair[1]), line => line.text)
										],
										Array.flatMap(line => String.split(/[^\w-]+/u)(String.toLowerCase(line.text))),
										Array.filter(word => word.length >= 3),
										Array.dedupe
									)
							})
						})
					),
				{concurrency: 'unbounded'}
			),
			[...translated.imports, ...after.imports]
		),
		// An area whose files only follow moved code holds nothing to read.
		area => area.lines > 0
	)
	const substance = Number.sumAll(Array.map(edited, file => file.lines))
	const outside = Number.sumAll(Array.map(Array.drop(areas, 1), area => area.lines))
	return {
		areas: Array.map(areas, area => ({
			...area,
			files: Array.filter(area.files, file => Option.exists(Record.get(lines, file), count => count > 0))
		})),
		base: from,
		config: Array.flatten(
			yield* Effect.forEach(
				Array.filter(authored, change => isConfiguration(change.file) || isSettings(change.file)),
				change => configOf(before, after, change),
				{concurrency: 'unbounded'}
			)
		),
		contracts: Array.flatMap(owners, owner => {
			const previous = contractsOf(beforeFacts, owner)
			const next = contractsOf(afterFacts, owner)
			const changed = Array.map(
				Array.filter(schemas, entry => Array.contains([owner, RUNTIME], packageOf(entry.file))),
				entry => entry.name
			)
			return pipe(
				[...Record.keys(previous), ...Record.keys(next)],
				Array.dedupe,
				Array.sort(String.Order),
				Array.flatMap(key => {
					// A contract whose own text is unchanged still changes when a schema it reaches does.
					const via = Option.match(Record.get(next, key), {
						onNone: () => [],
						onSome: contract => Array.intersection(reach(schemaFacts(afterFacts, owner), contract.names), changed)
					})
					return Option.toArray(
						Option.map(
							Option.orElse(
								delta(Record.get(previous, key), Record.get(next, key), (first, second) => first.text === second.text),
								() => Option.filter(Option.some<Delta>('changed'), () => Array.isReadonlyArrayNonEmpty(via))
							),
							change => ({change, contract: key, owner, via})
						)
					)
				})
			)
		}),
		dependencies: yield* dependenciesOf(before, after, changes),
		diagrams: {
			modules: moduleDiagram(
				settled,
				after,
				// A deleted file whose code moved is drawn where it went.
				Array.map(
					Array.filter(classified.files, file => file.kind !== 'imports'),
					file => moved(file.file)
				)
			),
			moves: moveDiagram(
				before,
				after,
				Array.map(
					Array.filter(authored, change => change.from !== change.file),
					change => ({from: change.from, to: change.file})
				),
				classified.moves
			),
			packages: packageDiagram(settled, after),
			services: Array.getSomes(
				Array.map(
					Array.filter(owners, owner => String.startsWith('apps/')(owner)),
					owner => servicesOf(beforeFacts, afterFacts, owner)
				)
			)
		},
		exportMaps: Array.flatten(
			yield* Effect.forEach(
				Array.filter(authored, change => String.endsWith('package.json')(change.file)),
				change => exportMapOf(before, after, change, moved),
				{concurrency: 'unbounded'}
			)
		),
		exports,
		files: Array.map(classified.files, file => ({...file, deleted: !Array.contains(after.files, file.file)})),
		generated: Array.map(
			Array.filter(changes, change => isGenerated(change.file)),
			change => change.file
		),
		head,
		// Past a quarter of the changed lines outside the main area, the change mixes work a reader checks apart.
		mixed: outside * 4 > substance,
		moves: classified.moves,
		reuses: classified.reuses,
		routes: Array.flatMap(owners, owner => {
			const previous = routesOf(beforeFacts, before.files, owner)
			const next = routesOf(afterFacts, after.files, owner)
			return [
				...Array.map(Array.difference(next, previous), route => ({change: 'added' as const, owner, route})),
				...Array.map(Array.difference(previous, next), route => ({change: 'removed' as const, owner, route}))
			]
		}),
		schemas: Array.map(schemas, entry => ({
			...entry,
			stored: Array.contains(
				[...storedOf(beforeFacts, packageOf(entry.file)), ...storedOf(afterFacts, packageOf(entry.file))],
				entry.name
			)
		})),
		size: {
			added: Number.sumAll(Array.map(authored, change => change.added)),
			files: authored.length,
			removed: Number.sumAll(Array.map(authored, change => change.removed)),
			substance
		},
		suppressions: movedApart(
			yield* Effect.forEach(
				code,
				change =>
					Effect.map(
						Effect.all([before.read(change.from), after.read(change.file)], {concurrency: 'unbounded'}),
						pair => [
							...Array.map(
								surplus(suppressionsOf(pair[1]), suppressionsOf(pair[0]), entry => entry.text),
								entry => ({...entry, change: 'added' as const, file: change.file})
							),
							...Array.map(
								surplus(suppressionsOf(pair[0]), suppressionsOf(pair[1]), entry => entry.text),
								entry => ({...entry, change: 'removed' as const, file: change.from})
							)
						]
					),
				{concurrency: 'unbounded'}
			)
		)
	}
}, Effect.scoped)

export type ChangeMap = Effect.Success<ReturnType<typeof mapOf>>
