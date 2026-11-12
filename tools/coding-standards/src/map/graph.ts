import {Array, Boolean, Graph, Number, Option, Order, Record, String, pipe} from 'effect'

import {matches} from '#lib/ast.ts'
import type {Provider} from '#map/facts.ts'
import type {Move} from '#map/moves.ts'

// Past this many boxes, or one and a third times as many arrows, a diagram no longer reads at 480 px.
const MAX_NODES = 12

function isLegible(view: {edges: readonly Edge[]; nodes: readonly unknown[]}) {
	return view.nodes.length <= MAX_NODES && 3 * view.edges.length <= 4 * MAX_NODES
}

// The repository's own files outside any workspace package.
export const ROOT = '(root)'

export type Edge = {from: string; to: string}

export type Status = 'added' | 'changed' | 'neighbour' | 'removed'

export type Diagram = {
	edges: (Edge & {label: string; status: 'added' | 'kept' | 'removed'})[]
	// A node's group is drawn as a box around it: its package, or the layer that provides it.
	nodes: {group: string; id: string; label: string; status: Status}[]
	// What the diagram leaves out, and why.
	omitted: string[]
}

export const isCode = matches(/\.(?:[cm]?[jt]sx?)$/u)

export const isTest = matches(/\.test\.[cm]?[jt]sx?$/u)

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

// A module's place below its package's `src`: `packages/runtime/src/server` is `packages/runtime/src` and `server`.
function placeOf(module: string) {
	const owner = packageOf(module)
	if (owner === ROOT) return {prefix: '', segments: [module]}
	const inside = String.slice(owner.length + 1)(module)
	if (String.startsWith('src/')(inside)) {
		return {prefix: `${owner}/src`, segments: String.split('/')(String.slice(4)(inside))}
	}
	return {prefix: owner, segments: String.split('/')(inside)}
}

// The module's folder `depth` levels below its package's `src`; depth 0 is the package itself.
function atDepth(module: string, depth: number) {
	if (depth === 0) return packageOf(module)
	const place = placeOf(module)
	return Array.join(Array.filter([place.prefix, ...Array.take(place.segments, depth)], String.isNonEmpty), '/')
}

// A package's own name: `deploy` for `apps/deploy`.
const shortName = String.replace(/^.*\//u, '')

function labelOf(node: string) {
	const owner = packageOf(node)
	if (owner === node || node === ROOT) return node
	if (owner === ROOT) return node
	return String.replace(/^src\//u, '')(String.slice(owner.length + 1)(node))
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

// Both revisions' edges that touch a focused node, each marked kept, added or removed.
function diffEdges(before: readonly Edge[], after: readonly Edge[], focus: readonly string[]) {
	return pipe(
		[...before, ...after],
		Array.filter(edge => Array.contains(focus, edge.from) || Array.contains(focus, edge.to)),
		Array.dedupeWith((first, second) => keyOf(first) === keyOf(second)),
		Array.map(edge => {
			if (!Array.some(before, other => keyOf(other) === keyOf(edge))) {
				return {...edge, label: '', status: 'added' as const}
			}
			if (!Array.some(after, other => keyOf(other) === keyOf(edge))) {
				return {...edge, label: '', status: 'removed' as const}
			}
			return {...edge, label: '', status: 'kept' as const}
		}),
		Array.sortWith(keyOf, String.Order)
	)
}

function statusOf(input: {
	after: readonly string[]
	before: readonly string[]
	focus: readonly string[]
	node: string
}) {
	if (!Array.contains(input.focus, input.node)) return 'neighbour' as const
	if (!Array.contains(input.before, input.node)) return 'added' as const
	if (!Array.contains(input.after, input.node)) return 'removed' as const
	return 'changed' as const
}

function isArchitecture(file: string) {
	return isCode(file) && !isTest(file)
}

function codeEdges(edges: readonly Edge[]) {
	return Array.filter(edges, edge => isArchitecture(edge.from) && isArchitecture(edge.to))
}

type Node = Diagram['nodes'][number]

// Package boxes outside the focus with the same arrows and status merge into one, such as every app that gained the same import.
function merged(nodes: Node[], edges: Diagram['edges']) {
	function signature(node: Node) {
		return Array.join(
			Array.sort(
				[
					node.status,
					...Array.flatMap(edges, edge => {
						if (edge.from === node.id) return [`> ${edge.to} ${edge.status}`]
						if (edge.to === node.id) return [`< ${edge.from} ${edge.status}`]
						return []
					})
				],
				String.Order
			),
			'\n'
		)
	}
	const groups = pipe(
		nodes,
		Array.filter(node => node.group === '' && (packageOf(node.id) === node.id || node.id === ROOT)),
		Array.groupBy(signature),
		Record.values,
		Array.filter(group => group.length > 1)
	)
	function idOf(node: string) {
		return Option.getOrElse(
			Option.map(
				Array.findFirst(groups, group => Array.some(group, member => member.id === node)),
				group =>
					Array.join(
						Array.map(group, member => member.id),
						' '
					)
			),
			() => node
		)
	}
	return {
		edges: pipe(
			edges,
			Array.map(edge => ({...edge, from: idOf(edge.from), to: idOf(edge.to)})),
			Array.dedupeWith((first, second) => keyOf(first) === keyOf(second))
		),
		nodes: [
			...Array.filter(nodes, node => idOf(node.id) === node.id),
			...Array.map(groups, group => ({
				group: '',
				id: Array.join(
					Array.map(group, member => member.id),
					' '
				),
				// Three names a line keep the box narrow.
				label: Array.join(
					Array.map(Array.chunksOf(group, 3), chunk =>
						Array.join(
							Array.map(chunk, member => shortName(member.id)),
							' · '
						)
					),
					'<br>'
				),
				status: Array.headNonEmpty(group).status
			}))
		]
	}
}

export type Revision = {files: string[]; imports: Edge[]}

// The import graph around the changed modules; past the limit, the package with the fewest changed files is drawn a folder higher, down to one box.
export function moduleDiagram(before: Revision, after: Revision, touched: readonly string[]) {
	const changed = Array.filter(touched, isArchitecture)
	const modules = Array.dedupe(Array.map(changed, moduleOf))
	const owners = Array.dedupe(Array.map(modules, packageOf))
	// Unchanged imports drawn: all around the change, those between changed boxes, or those between folders of a package drawn in detail.
	function viewAt(depths: Record<string, number>, kept: 'all' | 'changed' | 'inside') {
		function nodeOfModule(module: string) {
			return Option.match(Record.get(depths, packageOf(module)), {
				onNone: () => packageOf(module),
				onSome: depth => atDepth(module, depth)
			})
		}
		function nodeOf(file: string) {
			return nodeOfModule(moduleOf(file))
		}
		const focus = Array.dedupe(Array.map(modules, nodeOfModule))
		const all = diffEdges(edgesOf(codeEdges(before.imports), nodeOf), edgesOf(codeEdges(after.imports), nodeOf), focus)
		function isInside(node: string) {
			return node !== packageOf(node) && Array.contains(focus, node)
		}
		const edges = Array.filter(all, edge => {
			if (kept === 'all' || edge.status !== 'kept') return true
			if (kept === 'changed') return Array.contains(focus, edge.from) && Array.contains(focus, edge.to)
			return isInside(edge.from) && isInside(edge.to)
		})
		const sides = {
			after: Array.dedupe(Array.map(Array.filter(after.files, isArchitecture), nodeOf)),
			before: Array.dedupe(Array.map(Array.filter(before.files, isArchitecture), nodeOf))
		}
		const view = merged(
			Array.map(Array.dedupe([...focus, ...Array.flatMap(edges, edge => [edge.from, edge.to])]), node => ({
				group: Boolean.match(node !== packageOf(node) && Array.contains(owners, packageOf(node)), {
					onFalse: () => '',
					onTrue: () => packageOf(node)
				}),
				id: node,
				label: labelOf(node),
				status: statusOf({...sides, focus, node})
			})),
			edges
		)
		const hidden = all.length - edges.length
		return {
			...view,
			omitted: Array.filter(
				[
					Boolean.match(kept === 'inside', {
						onFalse: () => `${hidden} unchanged imports to modules the change does not touch are not drawn.`,
						onTrue: () => `${hidden} unchanged imports that leave a package are not drawn.`
					})
				],
				() => hidden > 0
			)
		}
	}
	function zoomed(depths: Record<string, number>): Record<string, number> {
		if (isLegible(viewAt(depths, 'inside'))) return depths
		// A package of one box drawn as the package can merge with others that share its arrows.
		const candidates = Array.filter(Record.toEntries(depths), entry => entry[1] > 0)
		if (!Array.isReadonlyArrayNonEmpty(candidates)) return depths
		const lightest = Array.min(
			candidates,
			Order.mapInput(Number.Order, (entry: readonly [string, number]) =>
				Array.countBy(changed, file => packageOf(file) === entry[0])
			)
		)
		return zoomed({...depths, [lightest[0]]: lightest[1] - 1})
	}
	const depths = zoomed(
		Record.fromEntries(
			Array.map(owners, owner => [
				owner,
				Array.reduce(
					Array.filter(modules, module => packageOf(module) === owner),
					0,
					(deepest, module) => Number.max(deepest, placeOf(module).segments.length)
				)
			])
		)
	)
	// The widest view that stays legible.
	const view = Option.getOrElse(
		Array.findFirst(
			Array.map(['all', 'changed'] as const, kept => viewAt(depths, kept)),
			isLegible
		),
		() => viewAt(depths, 'inside')
	)
	return {
		edges: view.edges,
		nodes: Array.sortWith(view.nodes, node => node.id, String.Order),
		omitted: [
			...view.omitted,
			...Array.filter(
				[`${view.nodes.length} boxes: more than one picture can hold at 480 px.`],
				() => view.nodes.length > MAX_NODES
			)
		]
	} satisfies Diagram
}

// Which packages import which, when the change adds or removes such an import; the packages on either end of one, with their other imports between them.
export function packageDiagram(before: Revision, after: Revision) {
	const previous = edgesOf(codeEdges(before.imports), packageOf)
	const next = edgesOf(codeEdges(after.imports), packageOf)
	const all = diffEdges(
		previous,
		next,
		Array.dedupe(Array.flatMap([...previous, ...next], edge => [edge.from, edge.to]))
	)
	const ends = pipe(
		all,
		Array.filter(edge => edge.status !== 'kept'),
		Array.flatMap(edge => [edge.from, edge.to]),
		Array.dedupe
	)
	if (!Array.isReadonlyArrayNonEmpty(ends)) return Option.none()
	const edges = Array.filter(all, edge => Array.contains(ends, edge.from) && Array.contains(ends, edge.to))
	return Option.some({
		...merged(
			Array.map(ends, node => ({group: '', id: node, label: node, status: 'neighbour' as const})),
			edges
		),
		omitted: []
	} satisfies Diagram)
}

// The folder a moved file or declaration left or reached, its `lib` folded in.
export function movedFolderOf(file: string) {
	return String.replace(/(?:\/lib)+$/u, '')(String.replace(/\/[^/]*$/u, '')(file))
}

function folderLabel(folder: string) {
	const owner = packageOf(folder)
	if (owner === ROOT) return folder
	return Array.join(
		Array.filter(
			[shortName(owner), String.replace(/^src\//u, '')(String.slice(owner.length + 1)(folder))],
			String.isNonEmpty
		),
		'/'
	)
}

// An arrow's files and the exported names it carries, counted once the label outgrows a short line.
function flowLabel(group: readonly {name: string}[]) {
	const files = Array.countBy(group, flow => flow.name === '')
	const names = Array.filter(
		Array.map(group, flow => flow.name),
		String.isNonEmpty
	)
	const counted = Array.filter(
		[Boolean.match(files === 1, {onFalse: () => `${files} files`, onTrue: () => '1 file'})],
		() => files > 0
	)
	const named = Array.join([...counted, ...names], ', ')
	if (named.length <= 32) return named
	return Array.join(
		[
			...counted,
			Boolean.match(names.length === 1, {onFalse: () => `${names.length} exports`, onTrue: () => '1 export'})
		],
		', '
	)
}

// What moved between folders: files git renames and exported declarations found unchanged or edited in another file, each arrow labelled with its files and names.
export function moveDiagram(before: Revision, after: Revision, renames: readonly Edge[], moves: readonly Move[]) {
	const flows = pipe(
		[
			...Array.map(
				Array.filter(renames, rename => !isTest(rename.from)),
				rename => ({from: movedFolderOf(rename.from), name: '', to: movedFolderOf(rename.to)})
			),
			...Array.map(
				Array.filter(moves, move => move.exported && !isTest(move.from)),
				move => ({from: movedFolderOf(move.from), name: move.name, to: movedFolderOf(move.to)})
			)
		],
		Array.filter(flow => flow.from !== flow.to),
		Array.groupBy(flow => keyOf(flow)),
		Record.values
	)
	if (!Array.isReadonlyArrayNonEmpty(flows)) return Option.none()
	const folders = {
		after: Array.dedupe(Array.map(after.files, movedFolderOf)),
		before: Array.dedupe(Array.map(before.files, movedFolderOf))
	}
	const sources = Array.dedupe(Array.map(flows, group => Array.headNonEmpty(group).from))
	const targets = Array.dedupe(Array.map(flows, group => Array.headNonEmpty(group).to))
	return Option.some({
		edges: Array.map(flows, group => ({
			from: `${Array.headNonEmpty(group).from} before`,
			label: flowLabel(group),
			status: 'kept' as const,
			to: `${Array.headNonEmpty(group).to} after`
		})),
		nodes: [
			...Array.map(sources, folder => ({
				group: 'before',
				id: `${folder} before`,
				label: folderLabel(folder),
				status: Boolean.match(Array.contains(folders.after, folder), {
					onFalse: () => 'removed' as const,
					onTrue: () => 'neighbour' as const
				})
			})),
			...Array.map(targets, folder => ({
				group: 'after',
				id: `${folder} after`,
				label: folderLabel(folder),
				status: Boolean.match(Array.contains(folders.before, folder), {
					onFalse: () => 'added' as const,
					onTrue: () => 'neighbour' as const
				})
			}))
		],
		omitted: []
	} satisfies Diagram)
}

export type Providers = {providers: Provider[]; services: string[]}

// One revision's services and layers: a layer that provides service classes is a bundle of them; any other layer, such as a router, is a node of its own.
function shapeOf(side: Providers) {
	const bundles = Record.fromEntries(
		Array.flatMap(side.providers, provider => {
			const parts = Array.intersection(provider.parts, side.services)
			if (provider.service || !Array.isReadonlyArrayNonEmpty(parts)) return []
			return [[provider.name, parts] as const]
		})
	)
	const nodes = Array.filter(side.providers, provider => provider.service || !Record.has(bundles, provider.name))
	return {
		bundles,
		edges: Array.flatMap(nodes, provider =>
			Array.map(Array.dedupe([...provider.libraries, ...Array.intersection(provider.yields, side.services)]), need => ({
				from: provider.name,
				to: need
			}))
		),
		names: Array.map(nodes, provider => provider.name),
		texts: Record.fromEntries(Array.map(side.providers, provider => [provider.name, provider.text] as const))
	}
}

// A library or runtime service is in neither list: it is a neighbour.
function providerStatus(input: {
	after: readonly string[]
	before: readonly string[]
	edited: readonly string[]
	node: string
}) {
	const was = Array.contains(input.before, input.node)
	const is = Array.contains(input.after, input.node)
	if (is && !was) return 'added' as const
	if (was && !is) return 'removed' as const
	if (Array.contains(input.edited, input.node)) return 'changed' as const
	return 'neighbour' as const
}

export type Bundle = {
	change: 'added' | 'changed' | 'removed'
	built: string[]
	gained: string[]
	layer: string
	lost: string[]
}

// The services each service or layer yields, drawn only around a shape change: a provider, a need or a layer's provided services gained or lost.
export function serviceDiagram(before: Providers, after: Providers) {
	const previous = shapeOf(before)
	const next = shapeOf(after)
	const bundles = pipe(
		Array.dedupe([...Record.keys(previous.bundles), ...Record.keys(next.bundles)]),
		Array.sort(String.Order),
		Array.flatMap(layer => {
			const was = Option.getOrElse(Record.get(previous.bundles, layer), () => [])
			const is = Option.getOrElse(Record.get(next.bundles, layer), () => [])
			const change = Option.getOrUndefined(
				Option.firstSomeOf([
					Option.filter(Option.some('added' as const), () => !Record.has(previous.bundles, layer) && is.length > 1),
					Option.filter(Option.some('removed' as const), () => !Record.has(next.bundles, layer) && was.length > 1),
					Option.filter(
						Option.some('changed' as const),
						() =>
							Record.has(previous.bundles, layer) &&
							Record.has(next.bundles, layer) &&
							(Array.isReadonlyArrayNonEmpty(Array.difference(was, is)) ||
								Array.isReadonlyArrayNonEmpty(Array.difference(is, was)))
					)
				])
			)
			if (change === undefined) return []
			const side = Boolean.match(change === 'removed', {
				onFalse: () => ({edges: next.edges, parts: is}),
				onTrue: () => ({edges: previous.edges, parts: was})
			})
			// The services it builds are the parts no other part needs; the rest are their own internals.
			const built = Array.filter(
				side.parts,
				part => !Array.some(side.edges, edge => edge.to === part && Array.contains(side.parts, edge.from))
			)
			return [
				{
					built,
					change,
					gained: Array.difference(Array.difference(is, was), built),
					layer,
					lost: Array.difference(Array.difference(was, is), built)
				} satisfies Bundle
			]
		})
	)
	const nodeDelta = [...Array.difference(next.names, previous.names), ...Array.difference(previous.names, next.names)]
	const edges = diffEdges(previous.edges, next.edges, Array.dedupe([...previous.names, ...next.names]))
	const focus = Array.dedupe([
		...nodeDelta,
		...pipe(
			edges,
			Array.filter(edge => edge.status !== 'kept'),
			Array.flatMap(edge => [edge.from, edge.to])
		),
		...Array.flatMap(bundles, bundle => [...bundle.built, ...bundle.gained, ...bundle.lost])
	])
	const edited = Array.filter(
		Array.intersection(next.names, previous.names),
		name => !Option.makeEquivalence(String.Equivalence)(Record.get(previous.texts, name), Record.get(next.texts, name))
	)
	if (!Array.isReadonlyArrayNonEmpty(focus)) return {bundles, diagram: Option.none(), edited}
	// Around the change, the app's own providers that need or are needed by it; a library service is drawn only where a need of it changed.
	const own = [...previous.names, ...next.names]
	const near = Array.filter(
		edges,
		edge =>
			(Array.contains(focus, edge.from) && (Array.contains(focus, edge.to) || Array.contains(own, edge.to))) ||
			(Array.contains(focus, edge.to) && Array.contains(own, edge.from))
	)
	const shown = Array.dedupe([...focus, ...Array.flatMap(near, edge => [edge.from, edge.to])])
	const drawn = Boolean.match(shown.length <= MAX_NODES, {onFalse: () => focus, onTrue: () => shown})
	const groups = Record.fromEntries(
		Array.flatMap(Record.toEntries(next.bundles), entry =>
			Array.filter(
				Array.map(entry[1], part => [part, entry[0]] as const),
				() => entry[1].length > 1
			)
		)
	)
	return {
		bundles,
		diagram: Option.some({
			edges: Array.filter(near, edge => Array.contains(drawn, edge.from) && Array.contains(drawn, edge.to)),
			nodes: Array.map(Array.sort(drawn, String.Order), node => ({
				group: Option.getOrElse(Record.get(groups, node), () => ''),
				id: node,
				label: node,
				status: providerStatus({after: next.names, before: previous.names, edited, node})
			})),
			omitted: Array.filter(
				[`${shown.length - focus.length} neighbouring services not drawn.`],
				() => shown.length > MAX_NODES
			)
		} satisfies Diagram),
		edited
	}
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
