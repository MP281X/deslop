import {Array, Boolean, Effect, Graph, Number, Option, Record, String, pipe} from 'effect'

import {matches} from '#lib/ast.ts'
import type {Facts} from '#map/facts.ts'
import {factsOf, lockedVersions, settings} from '#map/facts.ts'
import {ROOT, areasOf, isCode, moduleDiagram, packageOf, serviceDiagram} from '#map/graph.ts'
import type {Tree} from '#map/tree.ts'
import {output, treeOf} from '#map/tree.ts'

const RUNTIME = 'packages/runtime'

type Change = {added: number; file: string; from: string; removed: number}

export type Delta = 'added' | 'changed' | 'removed'

type Suppression = {line: number; text: string}

const isGenerated = matches(/(?:^|\/)pnpm-lock\.yaml$|\.gen\.[cm]?[jt]sx?$/u)

const isSchema = matches(/(?:^|\/)schema\.ts$/u)

const isSettings = matches(
	/(?:^|\/)(?:package\.json|vite\.config\.ts|tsconfig[^/]*\.json|\.fallowrc\.jsonc?)$|^tools\/coding-standards\/src\/lint\.ts$/u
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
				isCode(file) &&
				!matches(/\.test\.[cm]?[jt]sx?$/u)(file) &&
				!isGenerated(file) &&
				(Array.contains(owners, packageOf(file)) || packageOf(file) === RUNTIME)
		),
		file => Effect.map(tree.read(file), source => Option.map(source, text => [file, factsOf(file, text)] as const)),
		{concurrency: 'unbounded'}
	)
	return Record.fromEntries(Array.getSomes(read))
})

function factsOfPackage(facts: Record<string, Facts>, owner: string) {
	return Array.map(
		Array.filter(Record.toEntries(facts), entry => packageOf(entry[0]) === owner),
		entry => entry[1]
	)
}

// The package's and the runtime's `schema.ts` modules, where every schema a contract or a store holds is declared.
function schemaFacts(facts: Record<string, Facts>, owner: string) {
	return Array.map(
		Array.filter(
			Record.toEntries(facts),
			entry => isSchema(entry[0]) && Array.contains([owner, RUNTIME], packageOf(entry[0]))
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
				found => ({line: index + 1, text: String.trim(`${found[1] ?? ''}${found[2] ?? ''}`)})
			)
		)
	)
}

// Suppressions one side has more of than the other, by their exact text, so a moved line is no change.
function surplus(side: Suppression[], other: Suppression[]) {
	return Array.flatMap(Record.values(Array.groupBy(side, entry => entry.text)), group =>
		Array.takeRight(group, group.length - Array.countBy(other, entry => entry.text === Array.headNonEmpty(group).text))
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

// A configuration file's settings that changed; a rule's source, a workflow or the workspace file is listed whole.
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
	// A manifest's dependencies are the lockfile's to report, with the versions they resolve to.
	const changed = Array.filter(
		keyedDelta(yield* settingsOf(before, change.from), yield* settingsOf(after, change.file)),
		setting => !matches(/^(?:d|devD|optionalD|peerD)ependencies\./u)(setting.key)
	)
	if (!Array.isReadonlyArrayNonEmpty(changed) && String.endsWith('package.json')(change.file)) return []
	return [{...entry, kind: 'settings' as const, settings: changed}]
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
	return Option.map(serviceDiagram(providersOf(before, owner), providersOf(after, owner)), diagram => ({
		diagram,
		owner
	}))
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
	const lines = Number.sumAll(Array.map(authored, change => change.added + change.removed))
	const owners = Array.dedupe(Array.flatMap(changes, change => [packageOf(change.file), packageOf(change.from)]))
	const [beforeFacts, afterFacts] = yield* Effect.all([factsIn(before, owners), factsIn(after, owners)], {
		concurrency: 'unbounded'
	})
	const code = Array.filter(authored, change => isCode(change.file) || isCode(change.from))
	const exports = Array.filter(
		Array.map(code, change => ({
			file: change.file,
			names: Array.map(
				keyedDelta(exportsOf(Record.get(beforeFacts, change.from)), exportsOf(Record.get(afterFacts, change.file))),
				entry => ({change: entry.change, name: entry.key})
			)
		})),
		entry => Array.isReadonlyArrayNonEmpty(entry.names)
	)
	const schemas = pipe(
		exports,
		Array.filter(entry => isSchema(entry.file)),
		Array.flatMap(entry => Array.map(entry.names, found => ({...found, file: entry.file})))
	)
	return {
		// The largest area is the change's own; every other one is a candidate for an unrelated edit.
		areas: areasOf(
			yield* Effect.forEach(
				authored,
				change =>
					Effect.map(
						Effect.all([before.read(change.from), after.read(change.file)], {concurrency: 'unbounded'}),
						pair => ({
							file: change.file,
							lines: change.added + change.removed,
							terms: termsOf(change.file, after.files, exports),
							words: Boolean.match(packageOf(change.file) === ROOT, {
								onFalse: () => [],
								onTrue: () =>
									pipe(
										[...surplus(linesOf(pair[1]), linesOf(pair[0])), ...surplus(linesOf(pair[0]), linesOf(pair[1]))],
										Array.flatMap(line => String.split(/[^\w-]+/u)(String.toLowerCase(line.text))),
										Array.filter(word => word.length >= 3),
										Array.dedupe
									)
							})
						})
					),
				{concurrency: 'unbounded'}
			),
			[
				...Array.map(before.imports, edge => ({
					from: Option.getOrElse(
						Option.map(
							Array.findFirst(authored, change => change.from === edge.from),
							change => change.file
						),
						() => edge.from
					),
					to: Option.getOrElse(
						Option.map(
							Array.findFirst(authored, change => change.from === edge.to),
							change => change.file
						),
						() => edge.to
					)
				})),
				...after.imports
			]
		),
		base: from,
		config: Array.flatten(
			yield* Effect.forEach(
				Array.filter(
					authored,
					change =>
						matches(/^tools\/coding-standards\/src\/lint\/|^\.github\/workflows\/|^pnpm-workspace\.yaml$|\.oxlintrc/u)(
							change.file
						) || isSettings(change.file)
				),
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
				before,
				after,
				Array.dedupe(Array.flatMap(authored, change => [change.file, change.from]))
			),
			services: Array.getSomes(
				Array.map(
					Array.filter(owners, owner => String.startsWith('apps/')(owner)),
					owner => servicesOf(beforeFacts, afterFacts, owner)
				)
			)
		},
		exports,
		generated: Array.map(
			Array.filter(changes, change => isGenerated(change.file)),
			change => change.file
		),
		head,
		packages: pipe(
			Array.groupBy(authored, change => packageOf(change.file)),
			Record.toEntries,
			Array.map(entry => ({
				added: Number.sumAll(Array.map(entry[1], change => change.added)),
				files: entry[1].length,
				name: entry[0],
				removed: Number.sumAll(Array.map(entry[1], change => change.removed)),
				share: Number.round(
					Option.getOrElse(
						Number.divide(Number.sumAll(Array.map(entry[1], change => change.added + change.removed)) * 100, lines),
						() => 0
					),
					0
				)
			})),
			Array.sortWith(entry => -entry.share, Number.Order)
		),
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
		// Past either size a change holds more than one reading can check, whatever the map says.
		size: {files: authored.length, lines, tooLarge: authored.length > 60 || lines > 3000},
		suppressions: Array.flatten(
			yield* Effect.forEach(
				code,
				change =>
					Effect.map(
						Effect.all([before.read(change.from), after.read(change.file)], {concurrency: 'unbounded'}),
						pair => [
							...Array.map(surplus(suppressionsOf(pair[1]), suppressionsOf(pair[0])), entry => ({
								...entry,
								change: 'added' as const,
								file: change.file
							})),
							...Array.map(surplus(suppressionsOf(pair[0]), suppressionsOf(pair[1])), entry => ({
								...entry,
								change: 'removed' as const,
								file: change.from
							}))
						]
					),
				{concurrency: 'unbounded'}
			)
		)
	}
}, Effect.scoped)

export type ChangeMap = Effect.Success<ReturnType<typeof mapOf>>
