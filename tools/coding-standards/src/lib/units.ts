import {Array, Boolean, HashSet, Option, Predicate, String, pipe} from 'effect'

import type {ImportDeclaration, ImportDeclarationSpecifier} from 'oxc-parser'
import {parseSync} from 'oxc-parser'

import {matches} from '#lib/ast.ts'
import type {Node} from '#lib/nodes.ts'
import {childrenOf, field, isNode, nodeAt, textOf} from '#lib/nodes.ts'
import type {Kind} from '#lib/question.ts'

// A function longer than this is judged through its inner functions: past it, one question no longer has one answer.
const MAX_LINES = 150
const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

// A unit with only the imports it uses, so an import added for another unit asks nothing again; `ignores` names the questions its `judge-ignore` comments opt out of.
export type Unit = {ignores: HashSet.HashSet<string>; imports: string; kind: Kind; line: number; text: string}

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

// Every identifier in the unit's code, never a word in its strings or comments.
function identifiers(node: Node): string[] {
	return [
		...Option.toArray(
			Option.filter(Option.filter(field(node, 'name'), Predicate.isString), () => matches(/Identifier$/u)(node.type))
		),
		...Array.flatMap(childrenOf(node), identifiers)
	]
}

// One import line per binding the unit names, so a name like `useAtomValue` says where it comes from.
function importsUsed(source: string, declarations: ImportDeclaration[], node: Node) {
	const names = HashSet.fromIterable(identifiers(node))
	return pipe(
		declarations,
		Array.flatMap(declaration =>
			Array.map(
				Array.filter(declaration.specifiers, specifier => HashSet.has(names, specifier.local.name)),
				specifier => importLine(source, declaration, specifier)
			)
		),
		Array.join('\n')
	)
}

// The pieces of a file worth judging alone, outermost first so none holds another: test cases in test files, then functions of a bounded size.
export function units(filename: string, source: string) {
	const program = parseSync(filename, source).program
	const declarations = Array.filter(program.body, statement => statement.type === 'ImportDeclaration')
	const lines = String.split('\n')(source)
	const starts = Array.scan(lines, 0, (offset, line) => offset + line.length + 1)
	function lineOf(offset: number) {
		return (
			Option.getOrElse(
				Array.findLastIndex(starts, start => start <= offset),
				() => 0
			) + 1
		)
	}
	function unit(kind: Kind, node: Node, line: number) {
		const text = textOf(source, node)
		// The opt-outs sit in the comment lines right above the unit, beside any comment explaining it.
		const ignores = pipe(
			Array.take(lines, line - 1),
			Array.reverse,
			Array.takeWhile(matches(/^\s*\/\//u)),
			Array.flatMap(comment => Option.toArray(String.match(/judge-ignore (\S+) -- \S/u)(comment))),
			Array.flatMap(found => Option.toArray(Array.get(found, 1)))
		)
		return {ignores: HashSet.fromIterable(ignores), imports: importsUsed(source, declarations, node), kind, line, text}
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
	return visit(program, Option.none())
}
