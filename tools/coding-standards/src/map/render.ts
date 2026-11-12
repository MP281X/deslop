import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'

import type {ChangeMap, Delta} from '#map.ts'

import type {Diagram} from '#map/graph.ts'
import {ROOT, packageOf} from '#map/graph.ts'

// A list longer than this folds into counts, so the whole map reads in under a minute.
const MAX_ITEMS = 8

const MARK: Record<Delta, string> = {added: '+', changed: '~', removed: '−'}

const COLOUR = {added: '#3fb950', changed: '#d29922', removed: '#f85149'}

type Setting = ChangeMap['config'][number]['settings'][number]

// One line of a list, the folder or package it folds into, and the change kinds it counts as.
type Item = {atoms: string[]; line: string; place: string}

function code(text: string) {
	return `\`${String.replaceAll('`', "'")(text)}\``
}

function clipped(text: string) {
	if (text.length <= 48) return text
	return `${String.slice(0, 47)(text)}…`
}

function when(condition: boolean, lines: string[]) {
	return Array.filter(lines, () => condition)
}

function folderOf(file: string) {
	return Option.getOrElse(Option.liftPredicate(String.replace(/\/?[^/]*$/u, '')(file), String.isNonEmpty), () => ROOT)
}

function counted(word: string, count: number) {
	if (word === 'area' && count !== 1) return `${count} areas`
	return `${count} ${word}`
}

// Each kind counted once, in a fixed order: `3 added, 25 changed`.
function tally(atoms: string[]) {
	return pipe(
		Array.groupBy(atoms, Function.identity),
		Record.toEntries,
		Array.sortWith(entry => entry[0], String.Order),
		Array.map(entry => counted(entry[0], entry[1].length)),
		Array.join(', ')
	)
}

function folded(items: Item[], coarser: (place: string) => string) {
	return pipe(
		Array.groupBy(items, item => coarser(item.place)),
		Record.toEntries,
		Array.sortWith(entry => entry[0], String.Order),
		// A group of one keeps its own line, which says more than a count.
		Array.map(entry => {
			if (entry[1].length === 1) return Array.headNonEmpty(entry[1]).line
			return `${code(entry[0])}: ${tally(Array.flatMap(entry[1], item => item.atoms))}`
		})
	)
}

// A long list folds by folder, then by package, into counts; every change stays counted and JSON keeps each one.
function fit(items: Item[], coarser: (place: string) => string = packageOf) {
	if (items.length <= MAX_ITEMS) return Array.map(items, item => item.line)
	const byPlace = folded(items, Function.identity)
	if (byPlace.length <= MAX_ITEMS) return byPlace
	return folded(items, coarser)
}

function section(title: string, lines: string[]) {
	return when(Array.isReadonlyArrayNonEmpty(lines), [`**${title}**`, '', ...Array.map(lines, line => `- ${line}`), ''])
}

function notes(diagram: Diagram) {
	return Array.map(diagram.omitted, note => `_${note}_`)
}

function mermaidOf(diagram: Diagram) {
	const ids = Record.fromEntries(Array.map(diagram.nodes, (node, index) => [node.id, `n${index}`] as const))
	function idOf(node: string) {
		return Option.getOrElse(Record.get(ids, node), () => node)
	}
	function box(node: Diagram['nodes'][number]) {
		return `${idOf(node.id)}["${String.replaceAll('"', '#quot;')(node.label)}"]`
	}
	return [
		'```mermaid',
		'flowchart LR',
		...Array.flatMap(Record.toEntries(Array.groupBy(diagram.nodes, node => node.group)), (entry, index) => {
			if (entry[0] === '') return Array.map(entry[1], node => `\t${box(node)}`)
			return [`\tsubgraph g${index}["${entry[0]}"]`, ...Array.map(entry[1], node => `\t\t${box(node)}`), '\tend']
		}),
		...Array.map(
			diagram.edges,
			edge => `\t${idOf(edge.from)} ${{added: '==>', kept: '-->', removed: '-.->'}[edge.status]} ${idOf(edge.to)}`
		),
		...Array.map(Record.toEntries(COLOUR), entry => `\tclassDef ${entry[0]} stroke:${entry[1]},stroke-width:2px`),
		...Array.flatMap(diagram.nodes, node => {
			if (node.status === 'neighbour') return []
			return [`\tclass ${idOf(node.id)} ${node.status}`]
		}),
		...Array.flatMap(diagram.edges, (edge, index) => {
			if (edge.status === 'kept') return []
			return [`\tlinkStyle ${index} stroke:${COLOUR[edge.status]}`]
		}),
		'```',
		...notes(diagram),
		''
	]
}

function diagramSection(title: string, diagram: Diagram) {
	if (!Array.isReadonlyArrayNonEmpty(diagram.nodes)) {
		return when(Array.isReadonlyArrayNonEmpty(diagram.omitted), [`**${title}**`, '', ...notes(diagram), ''])
	}
	return [`**${title}**`, '', ...mermaidOf(diagram)]
}

function settingLine(entry: Setting) {
	if (entry.change === 'added') return `+ ${code(entry.key)} = ${code(clipped(entry.after ?? ''))}`
	if (entry.change === 'removed') return `− ${code(entry.key)}`
	return `~ ${code(entry.key)}: ${code(clipped(entry.before ?? ''))} → ${code(clipped(entry.after ?? ''))}`
}

// A file's settings, or past the limit their counts under each setting's first two keys, such as `lint.rules: 7 added`.
function settingsLine(settings: Setting[]) {
	if (!Array.isReadonlyArrayNonEmpty(settings)) return 'no setting changed'
	if (settings.length <= MAX_ITEMS) return Array.join(Array.map(settings, settingLine), ' · ')
	return pipe(
		Array.groupBy(settings, setting => Array.join(Array.take(String.split('.')(setting.key), 2), '.')),
		Record.toEntries,
		Array.map(entry => `${code(entry[0])}: ${tally(Array.map(entry[1], setting => setting.change))}`),
		Array.join(' · ')
	)
}

function dependencyLine(entry: ChangeMap['dependencies'][number]) {
	const where = Boolean.match(entry.importers.length === 1, {
		onFalse: () => `${entry.importers.length} packages`,
		// pnpm names the workspace root `.`.
		onTrue: () => String.replace(/^\.$/u, 'root')(Array.join(entry.importers, ''))
	})
	if (entry.change === 'added') return `+ ${code(entry.name)} ${entry.after ?? ''} (${where})`
	if (entry.change === 'removed') return `− ${code(entry.name)} ${entry.before ?? ''} (${where})`
	return `↑ ${code(entry.name)} ${entry.before ?? ''} → ${entry.after ?? ''} (${where})`
}

function areaLine(area: ChangeMap['areas'][number]) {
	const shown = Array.join(Array.map(Array.take(area.files, 3), code), ', ')
	const lines = Boolean.match(area.lines === 1, {onFalse: () => `${area.lines} lines`, onTrue: () => '1 line'})
	if (area.files.length <= 3) return `${shown} (${lines})`
	return `${shown} and ${area.files.length - 3} more (${lines})`
}

function suffix(items: string[], prefix: string) {
	if (!Array.isReadonlyArrayNonEmpty(items)) return ''
	return `${prefix}${Array.join(Array.map(items, code), ', ')}`
}

// The map as Markdown GitHub renders in a pull request body: counts and lists first, then the diagrams.
export function markdownOf(map: ChangeMap) {
	const lists = {
		configuration: fit([
			...Array.map(
				Array.filter(map.config, entry => entry.kind === 'settings'),
				entry => ({
					atoms: Array.map(entry.settings, setting => setting.change),
					line: `${code(entry.file)}: ${settingsLine(entry.settings)}`,
					place: folderOf(entry.file)
				})
			),
			// Rule sources, workflows and the workspace file are listed whole, one line per folder.
			...pipe(
				Array.filter(map.config, entry => entry.kind === 'file'),
				Array.groupBy(entry => folderOf(entry.file)),
				Record.toEntries,
				Array.map(entry => ({
					atoms: Array.map(entry[1], found => found.change),
					line: `${code(Boolean.match(entry[0] === ROOT, {onFalse: () => `${entry[0]}/`, onTrue: () => ROOT}))}: ${Array.join(
						Array.map(entry[1], found => `${MARK[found.change]}${String.replace(/^.*\//u, '')(found.file)}`),
						' '
					)}`,
					place: entry[0]
				}))
			)
		]),
		contracts: fit(
			Array.map(map.contracts, entry => ({
				atoms: [entry.change],
				line: `${MARK[entry.change]} ${entry.owner} ${code(entry.contract)}${suffix(entry.via, ' via ')}`,
				place: `${entry.owner} ${String.replace(/ .*$/u, '')(entry.contract)}`
			}))
		),
		// Folded dependencies count per npm scope or name prefix (`@effect`, `expo`), since every package shares most of them.
		dependencies: fit(
			Array.map(map.dependencies, entry => ({
				atoms: [entry.change],
				line: dependencyLine(entry),
				place: String.replace(/[/-].*$/u, '')(entry.name)
			})),
			Function.identity
		),
		// Files that add or remove an export come first: an edited export keeps its callers.
		exports: fit(
			Array.map(
				Array.sortWith(
					map.exports,
					entry => Array.every(entry.names, found => found.change === 'changed'),
					Boolean.Order
				),
				entry => ({
					atoms: Array.map(entry.names, found => found.change),
					line: `${code(entry.file)}: ${Array.join(
						Array.map(entry.names, found => `${MARK[found.change]}${found.name}`),
						' '
					)}`,
					place: folderOf(entry.file)
				})
			)
		),
		routes: fit(
			Array.map(map.routes, entry => ({
				atoms: [entry.change],
				line: `${MARK[entry.change]} ${entry.owner} ${code(entry.route)}`,
				place: entry.owner
			}))
		),
		schemas: fit(
			Array.map(map.schemas, entry => ({
				atoms: [entry.change],
				line: `${MARK[entry.change]} ${code(entry.name)}${Boolean.match(entry.stored, {onFalse: () => '', onTrue: () => ' (stored)'})} in ${code(entry.file)}`,
				place: folderOf(entry.file)
			}))
		),
		suppressions: fit(
			Array.map(map.suppressions, entry => ({
				atoms: [entry.change],
				line: `${MARK[entry.change]} ${code(`${entry.file}:${entry.line}`)} ${code(clipped(entry.text))}`,
				place: folderOf(entry.file)
			}))
		)
	}
	const empty = pipe(
		Record.toEntries(lists),
		Array.filter(entry => !Array.isReadonlyArrayNonEmpty(entry[1])),
		Array.map(entry => entry[0])
	)
	return Array.join(
		[
			`${code(`${String.slice(0, 9)(map.base)}..${String.slice(0, 9)(map.head)}`)} · ${map.size.files} files · +${Array.reduce(map.packages, 0, (total, entry) => total + entry.added)} −${Array.reduce(map.packages, 0, (total, entry) => total + entry.removed)}${suffix(map.generated, ' · generated: ')}`,
			'',
			...when(map.size.tooLarge, [
				'> [!WARNING]',
				`> Too large to summarise honestly: ${map.size.files} files and ${map.size.lines} changed lines in ${map.areas.length} areas. A list over ${MAX_ITEMS} entries is folded into counts per folder or package; split the change.`,
				''
			]),
			'| Package | Files | Lines | Share |',
			'| --- | --: | --: | --: |',
			...Array.map(
				map.packages,
				entry => `| ${code(entry.name)} | ${entry.files} | +${entry.added} −${entry.removed} | ${entry.share}% |`
			),
			'',
			...section('Exports', lists.exports),
			...section('Routes', lists.routes),
			...section('Schemas', lists.schemas),
			...section('Contracts', lists.contracts),
			...section('Dependencies', lists.dependencies),
			...section('Configuration', lists.configuration),
			...section('Suppressions', lists.suppressions),
			...Option.match(Array.head(map.areas), {
				onNone: () => [],
				onSome: area => [
					`**Main area**: ${areaLine(area)}`,
					'',
					...section(
						'Outside the main area: no import, place or mention ties these to it',
						fit(
							Array.map(Array.drop(map.areas, 1), other => ({
								atoms: ['area'],
								line: areaLine(other),
								place: folderOf(Array.join(Array.take(other.files, 1), ''))
							}))
						)
					)
				]
			}),
			...when(Array.isReadonlyArrayNonEmpty(empty), [`No change to ${Array.join(empty, ', ')}.`, '']),
			...diagramSection('Modules', map.diagrams.modules),
			...Array.flatMap(map.diagrams.services, entry => diagramSection(`Services in ${entry.owner}`, entry.diagram)),
			...when(Array.isReadonlyArrayNonEmpty(map.diagrams.modules.nodes), [
				'Amber boxes changed, green ones were added and red ones removed; thick green arrows are new and dotted red ones gone.'
			])
		],
		'\n'
	)
}
