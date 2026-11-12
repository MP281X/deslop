import {Array, Boolean, Function, Number, Option, Record, String, pipe} from 'effect'

import type {ChangeMap, Delta, SettingLine} from '#map.ts'

import type {Bundle, Diagram} from '#map/graph.ts'
import {ROOT, isTest, movedFolderOf, packageOf} from '#map/graph.ts'

// A list longer than this folds into counts, so the whole map reads in under two minutes; contracts never fold.
const MAX_ITEMS = 8

const MARK: Record<Delta, string> = {added: '+', changed: '~', removed: '−'}

const COLOUR = {added: '#3fb950', changed: '#d29922', removed: '#f85149'}

// One line of a list, the folder or package it folds into, and the change kinds it counts as.
type Item = {atoms: string[]; line: string; place: string}

function code(text: string) {
	return `\`${String.replaceAll('`', "'")(text)}\``
}

function clipped(text: string, length = 48) {
	if (text.length <= length) return text
	return `${String.slice(0, length - 1)(text)}…`
}

function when(condition: boolean, lines: string[]) {
	return Array.filter(lines, () => condition)
}

function folderOf(file: string) {
	return Option.getOrElse(Option.liftPredicate(String.replace(/\/?[^/]*$/u, '')(file), String.isNonEmpty), () => ROOT)
}

function plural(count: number, word: string, words = `${word}s`) {
	return `${count} ${Boolean.match(count === 1, {onFalse: () => words, onTrue: () => word})}`
}

// Each kind counted once, in a fixed order: `3 added, 25 changed`.
function tally(atoms: string[]) {
	return pipe(
		Array.groupBy(atoms, Function.identity),
		Record.toEntries,
		Array.sortWith(entry => entry[0], String.Order),
		Array.map(entry => `${entry[1].length} ${entry[0]}`),
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

// The first few names and how many more.
function names(items: readonly string[], limit = 4) {
	const shown = Array.join(Array.map(Array.take(items, limit), code), ', ')
	if (items.length <= limit) return shown
	return `${shown} and ${items.length - limit} more`
}

function section(title: string, lines: string[]) {
	return when(Array.isReadonlyArrayNonEmpty(lines), [
		`**${title}**`,
		'',
		...Array.map(lines, line =>
			Boolean.match(String.startsWith('  ')(line), {
				onFalse: () => `- ${line}`,
				onTrue: () => `  - ${String.trim(line)}`
			})
		),
		''
	])
}

// Mermaid reads a double quote as the end of a label.
const quoted = String.replaceAll('"', '#quot;')

function mermaidOf(diagram: Diagram) {
	const ids = Record.fromEntries(Array.map(diagram.nodes, (node, index) => [node.id, `n${index}`] as const))
	function idOf(node: string) {
		return Option.getOrElse(Record.get(ids, node), () => node)
	}
	function box(node: Diagram['nodes'][number]) {
		return `${idOf(node.id)}["${quoted(node.label)}"]`
	}
	return [
		'```mermaid',
		'flowchart LR',
		...Array.flatMap(Record.toEntries(Array.groupBy(diagram.nodes, node => node.group)), (entry, index) => {
			if (entry[0] === '') return Array.map(entry[1], node => `\t${box(node)}`)
			return [
				`\tsubgraph g${index}["${quoted(entry[0])}"]`,
				...Array.map(entry[1], node => `\t\t${box(node)}`),
				'\tend'
			]
		}),
		...Array.map(diagram.edges, edge => {
			const arrow = {added: '==>', kept: '-->', removed: '-.->'}[edge.status]
			const label = Boolean.match(edge.label === '', {onFalse: () => `|"${quoted(edge.label)}"|`, onTrue: () => ''})
			return `\t${idOf(edge.from)} ${arrow}${label} ${idOf(edge.to)}`
		}),
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
		...Array.map(diagram.omitted, note => `_${note}_`),
		''
	]
}

function diagramSection(title: string, lines: string[], diagram: Option.Option<Diagram>) {
	const drawn = Option.filter(diagram, found => Array.isReadonlyArrayNonEmpty(found.nodes))
	if (Option.isNone(drawn) && !Array.isReadonlyArrayNonEmpty(lines)) return []
	return [
		`**${title}**`,
		'',
		...Array.map(lines, line => `- ${line}`),
		...when(Array.isReadonlyArrayNonEmpty(lines), ['']),
		...Option.match(drawn, {onNone: () => [], onSome: mermaidOf})
	]
}

function itemsLine(added: readonly string[], removed: readonly string[]) {
	return Array.join(
		[
			...when(Array.isReadonlyArrayNonEmpty(added), [`+ ${names(added, 3)}`]),
			...when(Array.isReadonlyArrayNonEmpty(removed), [`− ${names(removed, 3)}`])
		],
		' · '
	)
}

function settingLine(entry: SettingLine) {
	if (entry.kind === 'element') {
		// The list, then the object's name in it: `boundaries.zones` `entry`.
		const named = Option.getOrElse(
			Option.map(
				String.match(/^(.*)\[([^[\]]*)\]$/u)(entry.key),
				parts => `${code(parts[1] ?? '')} ${code(parts[2] ?? '')}`
			),
			() => code(entry.key)
		)
		return `${MARK[entry.change]} ${named}${Boolean.match(Array.isReadonlyArrayNonEmpty(entry.fields), {
			onFalse: () => '',
			onTrue: () => `: ${clipped(Array.join(entry.fields, '; '), 80)}`
		})}`
	}
	if (entry.kind === 'items') return `${code(entry.key)}: ${itemsLine(entry.added, entry.removed)}`
	if (entry.change === 'added') return `+ ${code(entry.key)} = ${code(clipped(entry.after ?? ''))}`
	if (entry.change === 'removed') return `− ${code(entry.key)}`
	return `~ ${code(entry.key)}: ${code(clipped(entry.before ?? ''))} → ${code(clipped(entry.after ?? ''))}`
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
	if (area.files.length <= 3) return `${shown} (${plural(area.lines, 'line')})`
	return `${shown} and ${area.files.length - 3} more (${plural(area.lines, 'line')})`
}

function suffix(items: string[], prefix: string) {
	if (!Array.isReadonlyArrayNonEmpty(items)) return ''
	return `${prefix}${Array.join(Array.map(items, code), ', ')}`
}

// Where a reader looks: how many files only follow moved code, then the files that hold the changed lines, largest first.
function whereLines(map: ChangeMap) {
	const edited = pipe(
		map.files,
		Array.filter(file => file.kind === 'edited'),
		Array.sortWith(file => -file.lines, Number.Order)
	)
	const imports = Array.countBy(map.files, file => file.kind === 'imports')
	const moved = Array.countBy(map.files, file => file.kind === 'moved')
	const mechanical = Array.join(
		[...when(imports > 0, [`${imports} change only their imports`]), ...when(moved > 0, [`${moved} only move code`])],
		' and '
	)
	const held = `${plural(edited.length, 'file')} hold ${plural(map.size.substance, 'changed line')}`
	const rest = Array.drop(edited, MAX_ITEMS)
	return [
		`**Where the change is**: ${Boolean.match(mechanical === '', {onFalse: () => `of ${map.size.files} files, ${mechanical}; ${held}`, onTrue: () => held})}.`,
		'',
		...Array.map(Array.take(edited, MAX_ITEMS), file => `- ${code(file.file)} (${plural(file.lines, 'line')})`),
		...Option.match(Array.last(rest), {
			onNone: () => [],
			onSome: smallest => [
				`- ${rest.length} more, ${smallest.lines} to ${Option.getOrElse(
					Option.map(Array.head(rest), file => file.lines),
					() => 0
				)} lines each, in ${names(Array.dedupe(Array.map(rest, file => packageOf(file.file))), 6)}`
			]
		}),
		''
	]
}

function moveLines(map: ChangeMap) {
	// Declarations that moved between files of one folder never reach the diagram; a file they emptied was merged.
	const merges = pipe(
		map.moves,
		Array.filter(move => movedFolderOf(move.from) === movedFolderOf(move.to) && !isTest(move.from)),
		Array.groupBy(move => `${move.from} ${move.to}`),
		Record.values,
		Array.map(group => {
			const first = Array.headNonEmpty(group)
			const deleted = Array.some(map.files, file => file.file === first.from && file.deleted)
			return {
				atoms: [Boolean.match(deleted, {onFalse: () => 'moved code', onTrue: () => 'merged'})],
				line: `${code(first.from)} ${Boolean.match(deleted, {onFalse: () => 'moved code into', onTrue: () => 'merged into'})} ${code(String.replace(/^.*\//u, '')(first.to))}: ${plural(group.length, 'declaration')}`,
				place: movedFolderOf(first.from)
			}
		})
	)
	const editedOnTheWay = Array.dedupe(
		Array.map(
			Array.filter(map.moves, move => move.edited && move.exported),
			move => move.name
		)
	)
	return [
		...fit(merges),
		...when(Array.isReadonlyArrayNonEmpty(editedOnTheWay), [`Edited while moving: ${names(editedOnTheWay, 6)}`]),
		...Array.map(
			map.reuses,
			reuse => `${code(reuse.file)} drops its own ${code(reuse.name)} for ${code(reuse.source)}'s`
		)
	]
}

function bundleLine(bundle: Bundle) {
	const own = Boolean.match(Array.isReadonlyArrayNonEmpty(bundle.gained), {
		onFalse: () => '',
		onTrue: () => ` with its own ${names(bundle.gained)}`
	})
	const lost = Boolean.match(Array.isReadonlyArrayNonEmpty(bundle.lost), {
		onFalse: () => '',
		onTrue: () => `; no longer ${names(bundle.lost)}`
	})
	if (bundle.change === 'added') return `+ ${code(bundle.layer)} provides ${names(bundle.built)}${own}`
	if (bundle.change === 'removed') return `− ${code(bundle.layer)}, which provided ${names(bundle.built)}`
	return `${code(bundle.layer)} now provides ${names(bundle.built)}${own}${lost}`
}

function serviceSections(map: ChangeMap) {
	return Array.flatMap(map.diagrams.services, entry =>
		diagramSection(
			`Services in ${entry.owner}`,
			[
				...Array.map(entry.bundles, bundleLine),
				...when(Array.isReadonlyArrayNonEmpty(entry.edited), [
					`Code changed, needs unchanged: ${names(entry.edited, 6)}`
				])
			],
			entry.diagram
		)
	)
}

// A package's export map as what each old specifier became, grouped by the entry that serves it now.
function exportMapLines(entry: ChangeMap['exportMaps'][number]) {
	const changed = Array.filter(entry.entries, found => found.change !== 'removed')
	return [
		`${code(entry.owner)} export map: ${plural(entry.before, 'entry', 'entries')} become ${entry.after}`,
		...Array.map(changed, found => {
			const renamed = Array.flatMap(entry.renamed, old =>
				Array.map(
					Array.filter(old.to, target => target.entry === found.key),
					target => `${code(old.from)} → ${code(target.specifier)}`
				)
			)
			const kept = Array.countBy(entry.kept, target => target.entry === found.key)
			// An exact entry exposes only itself; a pattern can expose modules no entry served before.
			const exposed = Array.map(
				Array.filter(entry.exposed, target => target.entry === found.key && String.includes('*')(found.key)),
				target => target.specifier
			)
			return `  ${MARK[found.change]} ${code(found.key)} → ${code(found.after ?? '')}${Array.join(
				[
					...when(Array.isReadonlyArrayNonEmpty(renamed), [`: ${Array.join(renamed, ', ')}`]),
					...when(kept > 0, [`; keeps ${plural(kept, 'specifier')}`]),
					...when(Array.isReadonlyArrayNonEmpty(exposed), [`; newly exported ${names(exposed, 8)}`])
				],
				''
			)}`
		}),
		...Array.map(
			Array.filter(entry.renamed, old => !Array.isReadonlyArrayNonEmpty(old.to)),
			old => `  − ${code(old.from)}: no entry serves its module now`
		)
	]
}

// The map as Markdown GitHub renders in a pull request body: where the change is, the pictures, then the lists.
export function markdownOf(map: ChangeMap) {
	const lists = {
		configuration: [
			...pipe(
				map.config,
				Array.filter(entry => entry.kind === 'settings'),
				Array.flatMap(entry => [code(entry.file), ...Array.map(entry.settings, setting => `  ${settingLine(setting)}`)])
			),
			// Rule sources, workflows and the workspace file are listed whole, one line per folder.
			...pipe(
				Array.filter(map.config, entry => entry.kind === 'file'),
				Array.groupBy(entry => folderOf(entry.file)),
				Record.toEntries,
				Array.map(
					entry =>
						`${code(Boolean.match(entry[0] === ROOT, {onFalse: () => `${entry[0]}/`, onTrue: () => ROOT}))}: ${Array.join(
							Array.map(entry[1], found => `${MARK[found.change]}${String.replace(/^.*\//u, '')(found.file)}`),
							' '
						)}`
				)
			)
		],
		contracts: [
			...Array.flatMap(map.exportMaps, exportMapLines),
			...Array.map(
				map.contracts,
				entry => `${MARK[entry.change]} ${entry.owner} ${code(entry.contract)}${suffix(entry.via, ' via ')}`
			),
			...Array.map(map.routes, entry => `${MARK[entry.change]} ${entry.owner} ${code(entry.route)}`),
			...Array.map(
				Array.filter(map.schemas, entry => entry.stored),
				entry => `${MARK[entry.change]} stored ${code(entry.name)} in ${code(entry.file)}`
			)
		],
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
		schemas: fit(
			Array.map(
				Array.filter(map.schemas, entry => !entry.stored),
				entry => ({
					atoms: [entry.change],
					line: `${MARK[entry.change]} ${code(entry.name)} in ${code(entry.file)}${Boolean.match(
						entry.movedFrom === '',
						{onFalse: () => `, moved from ${code(entry.movedFrom)}`, onTrue: () => ''}
					)}`,
					place: folderOf(entry.file)
				})
			)
		),
		suppressions: fit(
			Array.map(map.suppressions, entry => ({
				atoms: [entry.change],
				line: `${MARK[entry.change]} ${code(`${entry.file}:${entry.line}`)} ${code(clipped(entry.text, 100))}`,
				place: folderOf(entry.file)
			}))
		)
	}
	const empty = pipe(
		Record.toEntries(lists),
		Array.filter(entry => !Array.isReadonlyArrayNonEmpty(entry[1])),
		Array.map(entry => entry[0])
	)
	const pictures = [
		...diagramSection('Packages', [], map.diagrams.packages),
		...diagramSection('Moves', moveLines(map), map.diagrams.moves),
		...diagramSection('Modules', [], Option.some(map.diagrams.modules)),
		...serviceSections(map)
	]
	return Array.join(
		[
			`${code(`${String.slice(0, 9)(map.base)}..${String.slice(0, 9)(map.head)}`)} · ${map.size.files} files · +${map.size.added} −${map.size.removed}${suffix(map.generated, ' · generated: ')}`,
			'',
			...when(map.mixed, [
				'> [!WARNING]',
				`> Mixes unrelated work: more than a quarter of the ${map.size.substance} changed lines lie outside the main area. Split it out.`,
				''
			]),
			...whereLines(map),
			...section(
				'Outside the main area: no import, place or mention ties these to it',
				fit(
					Array.map(Array.drop(map.areas, 1), other => ({
						atoms: ['areas'],
						line: areaLine(other),
						place: folderOf(Array.join(Array.take(other.files, 1), ''))
					}))
				)
			),
			...pictures,
			...section('Contracts', lists.contracts),
			...section('Exports', lists.exports),
			...section('Schemas', lists.schemas),
			...section('Dependencies', lists.dependencies),
			...section('Configuration', lists.configuration),
			...section('Suppressions', lists.suppressions),
			...when(Array.isReadonlyArrayNonEmpty(empty), [`No change to ${Array.join(empty, ', ')}.`, '']),
			...when(
				Array.some(pictures, line => line === '```mermaid'),
				[
					'Amber boxes changed, green ones were added and red ones removed; thick green arrows are new and dotted red ones gone.'
				]
			)
		],
		'\n'
	)
}
