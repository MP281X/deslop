import {Array, Boolean, HashSet, Option, Predicate, Record, String, pipe} from 'effect'

import type {ImportDeclaration, ImportDeclarationSpecifier} from 'oxc-parser'
import {parseSync, visitorKeys} from 'oxc-parser'

import {matches} from '#lib/ast.ts'
import type {Kind} from '#lib/question.ts'

// A function longer than this is judged through its inner functions: past it, one question no longer has one answer.
const MAX_LINES = 150
const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

const IGNORE = /judge-ignore (\S+) -- (\S.*)$/u

// A unit with only the imports it uses, so an import added for another unit asks nothing again; `names` are the imported bindings it uses, its text opens with the comments right above it, and `ignores` maps each question its `judge-ignore` comments opt out of to the reason given.
export type Unit = {
	end: number
	ignores: Record<string, string>
	imports: string
	kind: Kind
	line: number
	names: string[]
	start: number
	text: string
}

type Node = {type: string; start: number; end: number}

function isNode(value: unknown): value is Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

function field(node: unknown, key: string) {
	if (!Predicate.hasProperty(node, key)) return Option.none()
	return Option.some(node[key])
}

function nodeAt(node: Node, key: string) {
	return Option.filter(field(node, key), isNode)
}

function textOf(source: string, node: Node) {
	return String.slice(node.start, node.end)(source)
}

function isTestCall(source: string, node: Node) {
	if (node.type !== 'CallExpression') return false
	const title = pipe(field(node, 'arguments'), Option.map(Array.ensure), Option.flatMap(Array.head))
	return (
		Option.exists(nodeAt(node, 'callee'), callee => matches(/^(?:it|test)(?:\.\w+)*$/u)(textOf(source, callee))) &&
		Option.exists(title, value => isNode(value) && Array.contains(['Literal', 'TemplateLiteral'], value.type))
	)
}

function nameOf(node: Node, parent: Option.Option<Node>) {
	return pipe(
		Option.orElse(nodeAt(node, 'id'), () =>
			pipe(
				parent,
				Option.filter(found => found.type === 'VariableDeclarator'),
				Option.flatMap(found => nodeAt(found, 'id'))
			)
		),
		Option.flatMap(identifier => field(identifier, 'name')),
		Option.filter(Predicate.isString)
	)
}

function importLine(source: string, declaration: ImportDeclaration, specifier: ImportDeclarationSpecifier) {
	const binding = textOf(source, specifier)
	const kind = Boolean.match(declaration.importKind === 'type', {onFalse: () => '', onTrue: () => 'type '})
	if (specifier.type === 'ImportSpecifier') {
		return `import ${kind}{${binding}} from ${textOf(source, declaration.source)}`
	}
	return `import ${kind}${binding} from ${textOf(source, declaration.source)}`
}

function childrenOf(node: Node) {
	return Array.flatMap(visitorKeys[node.type] ?? [], key =>
		Array.filter(Array.ensure(Option.getOrUndefined(field(node, key))), isNode)
	)
}

// Every identifier in the unit's code, never a word in its strings or comments.
function identifiers(node: Node): string[] {
	return [
		...Option.toArray(
			pipe(
				field(node, 'name'),
				Option.filter(Predicate.isString),
				Option.filter(() => matches(/Identifier$/u)(node.type))
			)
		),
		...Array.flatMap(childrenOf(node), identifiers)
	]
}

// Why the parser cannot read a file, such as a syntax error or a NUL byte: its units would be partial, so none is asked.
export function parseError(filename: string, source: string) {
	return Option.map(Array.head(parseSync(filename, source).errors), error => error.message)
}

// Each imported binding of a file and its import line, so a unit's imports can be compared with the file's before the change.
export function importLines(filename: string, source: string) {
	return Record.fromEntries(
		Array.flatMap(parseSync(filename, source).program.body, statement => {
			if (statement.type !== 'ImportDeclaration') return []
			return Array.map(
				statement.specifiers,
				specifier => [specifier.local.name, importLine(source, statement, specifier)] as const
			)
		})
	)
}

// The pieces of a file worth judging alone, outermost first so none holds another: test cases in test files, then functions of a bounded size.
export function units(filename: string, source: string) {
	const parsed = parseSync(filename, source)
	const imported = importLines(filename, source)
	const lines = String.split(source, '\n')
	const starts = Array.scan(lines, 0, (offset, line) => offset + line.length + 1)
	function lineOf(offset: number) {
		return (
			pipe(
				starts,
				Array.findLastIndex(start => start <= offset),
				Option.getOrElse(() => 0)
			) + 1
		)
	}
	// The lines that hold only a `//` comment, by the parser's own reading, so a string or template that quotes one is code.
	const commentLines = HashSet.fromIterable(
		Array.flatMap(parsed.comments, comment => {
			const line = lineOf(comment.start)
			if (comment.type !== 'Line' || !matches(/^\s*$/u)(String.slice(starts[line - 1] ?? 0, comment.start)(source))) {
				return []
			}
			return [line]
		})
	)
	function unit(kind: Kind, node: Node, line: number) {
		// The opt-outs sit in the comment lines right above the unit, beside any comment explaining it, which Jev reads with the code.
		const above = pipe(
			Array.range(1, line - 1),
			Array.reverse,
			Array.takeWhile(number => HashSet.has(commentLines, number)),
			Array.reverse,
			Array.map(number => String.trimStart(lines[number - 1] ?? ''))
		)
		const names = Array.filter(Array.dedupe(identifiers(node)), name => Record.has(imported, name))
		return {
			end: lineOf(node.end),
			ignores: Record.fromEntries(
				Array.flatMap(above, comment =>
					Option.toArray(Option.map(String.match(IGNORE)(comment), found => [found[1] ?? '', found[2] ?? ''] as const))
				)
			),
			imports: pipe(
				Record.toEntries(imported),
				Array.filter(entry => Array.contains(names, entry[0])),
				Array.map(entry => entry[1]),
				Array.join('\n')
			),
			kind,
			line,
			names,
			start: line - above.length,
			text: Array.join([...Array.filter(above, comment => !matches(IGNORE)(comment)), textOf(source, node)], '\n')
		}
	}
	const tests = matches(/\.test\.[cm]?[jt]sx?$/u)(filename)
	const tsx = String.endsWith('.tsx')(filename)
	function visit(node: Node, parent: Option.Option<Node>): Unit[] {
		const line = lineOf(node.start)
		const length = lineOf(node.end) - line + 1
		if (tests && isTestCall(source, node) && length <= MAX_LINES) return [unit('test', node, line)]
		if (Array.contains(FUNCTIONS, node.type) && length <= MAX_LINES) {
			// A function of a few lines holds too little to judge.
			if (length < 6) return []
			return [
				unit(
					Boolean.match(tsx && Option.exists(nameOf(node, parent), matches(/^[A-Z]/u)), {
						onFalse: () => 'code',
						onTrue: () => 'component'
					}),
					node,
					line
				)
			]
		}
		return Array.flatMap(childrenOf(node), next => visit(next, Option.some(node)))
	}
	return visit(parsed.program, Option.none())
}
