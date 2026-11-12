import {Array, Boolean, Graph, Number, Option, Record, String, pipe} from 'effect'

import {matches} from '#lib/ast.ts'
import type {Provider} from '#map/facts.ts'

// Past this many boxes a diagram stops being read in a glance.
const MAX_NODES = 24

// The repository's own files outside any workspace package.
export const ROOT = '(root)'

export type Edge = {from: string; to: string}

export type Status = 'added' | 'changed' | 'neighbour' | 'removed'

export type Diagram = {
	edges: (Edge & {status: 'added' | 'kept' | 'removed'})[]
	nodes: {group: string; id: string; label: string; status: Status}[]
	// Why part of the neighbourhood, or the whole diagram, is not drawn.
	omitted: string[]
}

export const isCode = matches(/\.(?:[cm]?[jt]sx?)$/u)

export function packageOf(file: string) {
	return Option.getOrElse(
		Option.flatMap(String.match(/^(?:apps|packages|tools)\/[^/]+/u)(file), Array.head),
		() => ROOT
	)
}

// A module is a folder, its `lib` folded in; a file directly in a package's root or `src` is a module of its own.
export function moduleOf(file: string) {
	const folder = String.replace(/(?:\/lib)+$/u, '')(String.replace(/\/[^/]*$/u, '')(file))
	if (!String.includes('/')(file) || folder === packageOf(file) || folder === `${packageOf(file)}/src`) {
		return String.replace(/\.[^.]+$/u, '')(file)
	}
	return folder
}

function labelOf(module: string) {
	const owner = packageOf(module)
	if (owner === ROOT || owner === module) return module
	return String.replace(/^src\//u, '')(String.slice(owner.length + 1)(module))
}

function keyOf(edge: Edge) {
	return `${edge.from} ${edge.to}`
}

function edgesOf(edges: readonly Edge[], as: (node: string) => string) {
	return pipe(
		edges,
		Array.map(edge => ({from: as(edge.from), to: as(edge.to)})),
		Array.filter(edge => edge.from !== edge.to),
		Array.dedupeWith((first, second) => keyOf(first) === keyOf(second))
	)
}

// Both revisions' edges that touch a changed node, each marked kept, added or removed.
function diffEdges(before: readonly Edge[], after: readonly Edge[], touched: readonly string[]) {
	return pipe(
		[...before, ...after],
		Array.filter(edge => Array.contains(touched, edge.from) || Array.contains(touched, edge.to)),
		Array.dedupeWith((first, second) => keyOf(first) === keyOf(second)),
		Array.map(edge => {
			if (!Array.some(before, other => keyOf(other) === keyOf(edge))) return {...edge, status: 'added' as const}
			if (!Array.some(after, other => keyOf(other) === keyOf(edge))) return {...edge, status: 'removed' as const}
			return {...edge, status: 'kept' as const}
		}),
		Array.sortWith(keyOf, String.Order)
	)
}

function statusOf(input: {after: readonly string[]; before: readonly string[]; node: string; touched: string[]}) {
	if (!Array.contains(input.touched, input.node)) return 'neighbour' as const
	if (!Array.contains(input.before, input.node)) return 'added' as const
	if (!Array.contains(input.after, input.node)) return 'removed' as const
	return 'changed' as const
}

function otherEnd(edge: Edge, touched: readonly string[]) {
	if (Array.contains(touched, edge.from)) return [edge.to]
	if (Array.contains(touched, edge.to)) return [edge.from]
	return []
}

function codeModules(files: readonly string[]) {
	return Array.dedupe(Array.map(Array.filter(files, isCode), moduleOf))
}

export type Revision = {files: string[]; imports: Edge[]}

// The import graph between the changed modules and their direct neighbours; a neighbour in an untouched package is drawn as its package.
export function moduleDiagram(before: Revision, after: Revision, changed: string[]) {
	const touched = codeModules(changed)
	const owners = Array.dedupe(Array.map(touched, packageOf))
	if (touched.length > MAX_NODES) {
		return {
			edges: [],
			nodes: [],
			omitted: [`${touched.length} modules changed, too many to draw; split the change to see its shape.`]
		} satisfies Diagram
	}
	const inside = pipe(
		[...edgesOf(before.imports, moduleOf), ...edgesOf(after.imports, moduleOf)],
		Array.flatMap(edge => otherEnd(edge, touched)),
		Array.dedupe,
		Array.filter(module => !Array.contains(touched, module) && Array.contains(owners, packageOf(module)))
	)
	// A crowded diagram keeps only the imports between changed modules and the ones the change adds or removes.
	const crowded = touched.length + inside.length > MAX_NODES
	function drawn(file: string) {
		const module = moduleOf(file)
		if (Array.contains(touched, module) || (!crowded && Array.contains(inside, module))) return module
		return packageOf(module)
	}
	const all = diffEdges(edgesOf(before.imports, drawn), edgesOf(after.imports, drawn), touched)
	const edges = Array.filter(
		all,
		edge =>
			!crowded || edge.status !== 'kept' || (Array.contains(touched, edge.from) && Array.contains(touched, edge.to))
	)
	return {
		edges,
		nodes: pipe(
			[...touched, ...Array.flatMap(edges, edge => [edge.from, edge.to])],
			Array.dedupe,
			Array.sort(String.Order),
			Array.map(node => ({
				group: Boolean.match(Array.contains(owners, packageOf(node)), {
					onFalse: () => '',
					onTrue: () => packageOf(node)
				}),
				id: node,
				label: Boolean.match(node === packageOf(node) && Array.contains(owners, node), {
					onFalse: () => labelOf(node),
					onTrue: () => 'other modules'
				}),
				status: statusOf({after: codeModules(after.files), before: codeModules(before.files), node, touched})
			}))
		),
		omitted: Array.filter(
			[`${all.length - edges.length} unchanged imports to neighbouring modules not drawn.`],
			() => crowded
		)
	} satisfies Diagram
}

function textsOf(providers: readonly Provider[]) {
	return Record.fromEntries(Array.map(providers, provider => [provider.name, provider.text] as const))
}

export type Providers = {providers: Provider[]; services: string[]}

function yieldsOf(side: Providers) {
	return Array.flatMap(side.providers, provider =>
		Array.map([...provider.libraries, ...Array.intersection(provider.yields, side.services)], service => ({
			from: provider.name,
			to: service
		}))
	)
}

// Which services each layer yields, around the providers whose code changed; static, so a service reached only through a helper's parameter is not drawn.
export function serviceDiagram(before: Providers, after: Providers) {
	const beforeText = textsOf(before.providers)
	const afterText = textsOf(after.providers)
	const touched = pipe(
		[...Record.keys(beforeText), ...Record.keys(afterText)],
		Array.dedupe,
		Array.filter(
			name => !Option.makeEquivalence(String.Equivalence)(Record.get(beforeText, name), Record.get(afterText, name))
		)
	)
	if (!Array.isReadonlyArrayNonEmpty(touched)) return Option.none()
	const shown = Array.dedupe([
		...touched,
		...Array.flatMap([...yieldsOf(before), ...yieldsOf(after)], edge => otherEnd(edge, touched))
	])
	const crowded = shown.length > MAX_NODES
	const drawnNodes = Array.filter(shown, node => !crowded || Array.contains(touched, node))
	return Option.some({
		edges: Array.filter(
			diffEdges(yieldsOf(before), yieldsOf(after), touched),
			edge => Array.contains(drawnNodes, edge.from) && Array.contains(drawnNodes, edge.to)
		),
		nodes: Array.map(Array.sort(drawnNodes, String.Order), node => ({
			group: '',
			id: node,
			label: node,
			status: statusOf({after: Record.keys(afterText), before: Record.keys(beforeText), node, touched})
		})),
		omitted: Array.filter([`${shown.length - touched.length} neighbouring services not drawn.`], () => crowded)
	} satisfies Diagram)
}

const isManifest = matches(/(?:^|\/)(?:package\.json|pnpm-workspace\.yaml)$/u)

// One place a reader names: code's folder, a package for its other files, and outside the packages at most three folders, such as one skill with its references.
function areaKey(file: string) {
	if (!isCode(file) && packageOf(file) !== ROOT) return packageOf(file)
	const folders = Array.dropRight(String.split('/')(file), 1)
	if (!Array.isReadonlyArrayNonEmpty(folders)) return file
	if (isCode(file)) return Array.join(folders, '/')
	return Array.join(Array.take(folders, 3), '/')
}

// `terms` name what a file is (its package, a file name no other package has, the exports it changed); `words` are what a file outside the packages says in its changed lines.
export type Changed = {file: string; lines: number; terms: string[]; words: string[]}

function linesIn(changed: readonly Changed[], files: readonly string[]) {
	return Number.sumAll(
		Array.map(changed, entry =>
			Boolean.match(Array.contains(files, entry.file), {onFalse: () => 0, onTrue: () => entry.lines})
		)
	)
}

function isAnchored(files: readonly string[]) {
	return Array.some(files, file => packageOf(file) !== ROOT)
}

// Instructions and settings outside the packages join the largest area whose terms their changed lines mention, so documenting the change is not an unrelated edit.
function attachMentions(changed: readonly Changed[], areas: string[][]) {
	function homeOf(files: string[]) {
		const words = pipe(
			changed,
			Array.filter(entry => Array.contains(files, entry.file)),
			Array.flatMap(entry => entry.words)
		)
		return Array.findFirstIndex(
			areas,
			other =>
				isAnchored(other) &&
				Array.some(
					changed,
					entry => Array.contains(other, entry.file) && Array.some(entry.terms, term => Array.contains(words, term))
				)
		)
	}
	const homes = Array.map(areas, files => Option.filter(homeOf(files), () => !isAnchored(files)))
	function homeAt(index: number) {
		return Option.flatten(Array.get(homes, index))
	}
	return Array.flatMap(areas, (files, index) => {
		if (Option.isSome(homeAt(index))) return []
		return [[...files, ...Array.flatten(Array.filter(areas, (_, other) => Option.contains(homeAt(other), index)))]]
	})
}

// Changed files fall into areas joined by a direct import between them, a shared place, a dependency manifest, or a mention.
export function areasOf(changed: Changed[], imports: readonly Edge[]) {
	const files = Array.map(changed, entry => entry.file)
	const groups = Array.groupBy(files, areaKey)
	const manifests = Array.filter(files, isManifest)
	const graph = Graph.undirected<string, 'joined'>(mutable => {
		const indices = Record.fromEntries(Array.map(files, file => [file, Graph.addNode(mutable, file)] as const))
		function join(first: string, second: string) {
			Option.zipWith(Record.get(indices, first), Record.get(indices, second), (source, target) =>
				Graph.addEdge(mutable, source, target, 'joined')
			)
		}
		for (const edge of imports) join(edge.from, edge.to)
		for (const group of [...Record.values(groups), manifests]) {
			for (const file of group) Option.map(Array.head(group), first => join(first, file))
		}
		// Code joins the non-code files of its own package, such as the README or AGENTS.md beside it.
		for (const file of Array.filter(files, isCode)) {
			Option.map(Record.get(groups, packageOf(file)), group => join(file, Array.headNonEmpty(group)))
		}
	})
	return pipe(
		attachMentions(
			changed,
			pipe(
				Graph.connectedComponents(graph),
				Array.map(component => Array.getSomes(Array.map(component, index => Graph.getNode(graph, index)))),
				Array.sortWith(members => -linesIn(changed, members), Number.Order)
			)
		),
		// An area names its package files first, most changed lines first, then the instructions that joined them.
		Array.map(members => ({
			files: [
				...pipe(
					members,
					Array.filter(file => packageOf(file) !== ROOT),
					Array.sortWith(file => -linesIn(changed, [file]), Number.Order)
				),
				...Array.sort(
					Array.filter(members, file => packageOf(file) === ROOT),
					String.Order
				)
			],
			lines: linesIn(changed, members)
		})),
		Array.sortWith(area => -area.lines, Number.Order)
	)
}
