import {Array, Boolean, Option, Predicate, String, pipe} from 'effect'

import {matches} from '#rules/shared.ts'

// A function longer than this is judged through its inner functions: past it, one question no longer has one answer.
const MAX_LINES = 150
const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

export type UnitKind = 'code' | 'component' | 'test'
export type Unit = {kind: UnitKind; line: number; text: string}

// The span any parser's AST node carries, so oxc-parser's and Oxlint's trees both fit.
export type Node = {type: string; start: number; end: number}

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

// `it(...)`, `test(...)` or `it.effect(...)` with a written title.
function isTestCall(source: string, node: Node) {
	if (node.type !== 'CallExpression') return false
	const title = pipe(field(node, 'arguments'), Option.map(Array.ensure), Option.flatMap(Array.head))
	return (
		Option.exists(nodeAt(node, 'callee'), callee => matches(/^(?:it|test)(?:\.\w+)*$/u)(textOf(source, callee))) &&
		Option.exists(title, value => isNode(value) && Array.contains(['Literal', 'TemplateLiteral'], value.type))
	)
}

// A function's own name, or the name of the variable it is assigned to.
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

// The file's imports, sent with each of its units so a name like `useAtomValue` says where it comes from.
export function importsOf(program: Node, source: string) {
	return pipe(
		Array.filter(Array.ensure(Option.getOrUndefined(field(program, 'body'))), isNode),
		Array.filter(statement => statement.type === 'ImportDeclaration'),
		Array.map(statement => textOf(source, statement)),
		Array.join('\n')
	)
}

// The pieces of a file worth judging alone, outermost first so none holds another: test cases in test files, then functions of a bounded size.
export function units(input: {
	filename: string
	program: Node
	source: string
	visitorKeys: Readonly<Record<string, readonly string[]>>
}) {
	const starts = Array.scan(String.split('\n')(input.source), 0, (offset, line) => offset + line.length + 1)
	function lineOf(offset: number) {
		return (
			Option.getOrElse(
				Array.findLastIndex(starts, start => start <= offset),
				() => 0
			) + 1
		)
	}
	const tests = matches(/\.test\.[cm]?[jt]sx?$/u)(input.filename)
	const tsx = String.endsWith('.tsx')(input.filename)
	function visit(node: Node, parent: Option.Option<Node>): Unit[] {
		const line = lineOf(node.start)
		const lines = lineOf(node.end) - line + 1
		if (tests && isTestCall(input.source, node) && lines <= MAX_LINES) {
			return [{kind: 'test', line, text: textOf(input.source, node)}]
		}
		if (Array.contains(FUNCTIONS, node.type) && lines <= MAX_LINES) {
			// A function of a few lines holds too little to judge.
			if (lines < 6) return []
			return [
				{
					kind: Boolean.match(tsx && Option.exists(nameOf(node, parent), matches(/^[A-Z]/u)), {
						onFalse: () => 'code' as const,
						onTrue: () => 'component' as const
					}),
					line,
					text: textOf(input.source, node)
				}
			]
		}
		const children: Node[] = Array.flatMap(input.visitorKeys[node.type] ?? [], key =>
			Array.filter(Array.ensure(Option.getOrUndefined(field(node, key))), isNode)
		)
		return Array.flatMap(children, next => visit(next, Option.some(node)))
	}
	return visit(input.program, Option.none())
}
