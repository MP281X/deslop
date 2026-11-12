import {Array, Function, Number, Option, Record, String, pipe} from 'effect'

import type {Facts, Statement} from '#map/facts.ts'
import {isCode} from '#map/graph.ts'

// A `git diff -z -M --numstat` entry; a renamed file keeps its old path in `from`.
export type Change = {added: number; file: string; from: string; removed: number}

// How a file changed: only in its import statements, only by moving (itself, or declarations to or from other files), or in its own code.
export type Kind = 'edited' | 'imports' | 'moved'

// A declaration that left one file for another; `edited` when its text changed on the way.
export type Move = {edited: boolean; exported: boolean; from: string; name: string; to: string}

// A declaration a file dropped for an import of the same name: a duplicate replaced by the original.
export type Reuse = {file: string; name: string; source: string}

type Placed = {change: number; statement: Statement}

// The items one side has more of than the other, by key, so an item present on both sides, wherever it sits, is no change.
export function surplus<A>(side: readonly A[], other: readonly A[], key: (item: A) => string) {
	return Array.flatMap(Record.values(Array.groupBy(side, key)), group =>
		Array.takeRight(group, group.length - Array.countBy(other, item => key(item) === key(Array.headNonEmpty(group))))
	)
}

// The lines one text has and the other lacks, with repeats: an edited declaration's changed lines.
function lineDelta(before: readonly string[], after: readonly string[]) {
	return surplus(before, after, Function.identity).length + surplus(after, before, Function.identity).length
}

// Two texts are one declaration edited when at least half their lines are shared.
function isSimilar(first: Statement, second: Statement) {
	return 2 * lineDelta(first.lines, second.lines) <= first.lines.length + second.lines.length
}

// Each left item with the first unpaired right item it matches; the unpaired ones on both sides stay apart.
function pair<A>(lefts: readonly A[], rights: readonly A[], isPair: (left: A, right: A) => boolean) {
	const start: {pairs: (readonly [A, A])[]; rest: A[]; rights: A[]} = {pairs: [], rest: [], rights: [...rights]}
	return Array.reduce(lefts, start, (state, left) =>
		Option.match(
			Array.findFirstIndex(state.rights, right => isPair(left, right)),
			{
				onNone: () => ({...state, rest: [...state.rest, left]}),
				onSome: index => ({
					pairs: Option.match(Array.get(state.rights, index), {
						onNone: () => state.pairs,
						onSome: right => [...state.pairs, [left, right] as const]
					}),
					rest: state.rest,
					rights: Array.remove(state.rights, index)
				})
			}
		)
	)
}

function statementsAt(facts: Record<string, Facts>, file: string) {
	return Option.getOrElse(
		Option.map(Record.get(facts, file), found => found.statements),
		() => []
	)
}

function isNamed(first: Statement, second: Statement) {
	return first.key !== '' && first.key === second.key
}

// Every changed file's kind and changed lines, read from the top-level statements of both revisions: a statement found unchanged in another file moved, one with the same name and most lines in common moved and was edited, and only the rest is the change's own code.
export function classify(changes: readonly Change[], before: Record<string, Facts>, after: Record<string, Facts>) {
	const inPlace = Array.map(changes, (change, index) => {
		const previous = statementsAt(before, change.from)
		const next = statementsAt(after, change.file)
		const found = pair(
			surplus(previous, next, statement => statement.text),
			surplus(next, previous, statement => statement.text),
			// An unnamed statement, such as `runApp({…})`, is one edited when its text stays mostly the same.
			(left, right) => isNamed(left, right) || (left.key === '' && right.key === '' && isSimilar(left, right))
		)
		return {
			added: Array.map(found.rights, statement => ({change: index, statement}) satisfies Placed),
			edited: Number.sumAll(Array.map(found.pairs, entry => lineDelta(entry[0].lines, entry[1].lines))),
			removed: Array.map(found.rest, statement => ({change: index, statement}) satisfies Placed)
		}
	})
	const unchanged = pair(
		Array.flatMap(inPlace, entry => entry.removed),
		Array.flatMap(inPlace, entry => entry.added),
		(left, right) => left.statement.text === right.statement.text
	)
	const edited = pair(
		unchanged.rest,
		unchanged.rights,
		(left, right) => isNamed(left.statement, right.statement) && isSimilar(left.statement, right.statement)
	)
	const moved = [
		...Array.map(unchanged.pairs, entry => ({entry, isEdited: false})),
		...Array.map(edited.pairs, entry => ({entry, isEdited: true}))
	]
	function linesAt(index: number) {
		return Number.sumAll([
			Option.getOrElse(
				Option.map(Array.get(inPlace, index), entry => entry.edited),
				() => 0
			),
			...Array.map(
				Array.filter(edited.pairs, entry => entry[1].change === index),
				entry => lineDelta(entry[0].statement.lines, entry[1].statement.lines)
			),
			...Array.map(
				Array.filter([...edited.rest, ...edited.rights], entry => entry.change === index),
				entry => entry.statement.lines.length
			)
		])
	}
	function kindOf(change: Change, index: number, lines: number) {
		if (lines > 0) return 'edited' satisfies Kind
		if (
			change.from !== change.file ||
			Array.some(moved, found => found.entry[0].change === index || found.entry[1].change === index)
		) {
			return 'moved' satisfies Kind
		}
		return 'imports' satisfies Kind
	}
	return {
		files: Array.map(changes, (change, index) => {
			if (!isCode(change.file) && !isCode(change.from)) {
				const lines = change.added + change.removed
				return {...change, kind: kindOf(change, index, lines), lines}
			}
			const lines = linesAt(index)
			const sameImports = Option.getOrElse(
				Option.zipWith(Record.get(before, change.from), Record.get(after, change.file), (first, second) =>
					Record.makeEquivalence(String.Equivalence)(first.imported, second.imported)
				),
				() => false
			)
			// Nothing but comments or spacing outside the declarations changed: the whole diff is the change.
			if (lines === 0 && sameImports && change.from === change.file) {
				return {...change, kind: 'edited' as const, lines: change.added + change.removed}
			}
			return {...change, kind: kindOf(change, index, lines), lines}
		}),
		moves: pipe(
			moved,
			Array.filter(found => found.entry[0].statement.key !== ''),
			Array.flatMap(found =>
				Option.toArray(
					Option.zipWith(
						Array.get(changes, found.entry[0].change),
						Array.get(changes, found.entry[1].change),
						(from, to) =>
							({
								edited: found.isEdited,
								exported: found.entry[0].statement.exported || found.entry[1].statement.exported,
								from: from.from,
								name: String.replace(/^type /u, '')(found.entry[0].statement.key),
								to: to.file
							}) satisfies Move
					)
				)
			),
			Array.dedupeWith(
				(first, second) => first.from === second.from && first.to === second.to && first.name === second.name
			)
		),
		reuses: pipe(
			edited.rest,
			Array.flatMap(entry => {
				const name = String.replace(/^type /u, '')(entry.statement.key)
				return Option.toArray(
					Option.flatMap(Array.get(changes, entry.change), change =>
						Option.map(
							Option.flatMap(Record.get(after, change.file), found => Record.get(found.imported, name)),
							source => ({file: change.file, name, source}) satisfies Reuse
						)
					)
				)
			}),
			Array.dedupeWith((first, second) => first.file === second.file && first.name === second.name)
		)
	}
}
