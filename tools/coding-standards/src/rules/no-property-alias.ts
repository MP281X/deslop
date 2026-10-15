import {Array, Function, MutableList, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree, Token, Variable} from '@oxlint/plugins'

import {outermost, rootName, variableFromScope} from '#rules/shared.ts'

const functions = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

// A read inside a loop or a branch runs a different number of times than the declaration.
const deferred = [
	'ChainExpression',
	'ConditionalExpression',
	'DoWhileStatement',
	'ForInStatement',
	'ForOfStatement',
	'ForStatement',
	'IfStatement',
	'LogicalExpression',
	'SwitchStatement',
	'WhileStatement'
]

function insideFunction(node: ESTree.Node): boolean {
	if (Predicate.isNullish(node.parent) || node.parent.type === 'Program') return false
	if (Array.contains(functions, node.parent.type)) return true
	return insideFunction(node.parent)
}

// The root must name the same binding at every read, or inlining reads a shadowing one.
function sameRoot(input: {context: Context; declarator: ESTree.Node; name: string; read: ESTree.Node}) {
	return (
		Option.getOrUndefined(
			variableFromScope({name: input.name, scope: input.context.sourceCode.getScope(input.declarator)})
		) ===
		Option.getOrUndefined(variableFromScope({name: input.name, scope: input.context.sourceCode.getScope(input.read)}))
	)
}

function enclosed(input: {block: ESTree.Node; node: ESTree.Node; types: string[]}): boolean {
	if (Predicate.isNullish(input.node.parent) || input.node.parent === input.block) return false
	if (Array.contains(input.types, input.node.parent.type)) return true
	return enclosed({...input, node: input.node.parent})
}

function between(input: {declaration: ESTree.Node; node: ESTree.Node; read: ESTree.Node}) {
	return input.node.range[0] >= input.declaration.range[1] && input.node.range[1] <= input.read.range[0]
}

// `box[key] = 2` also writes to `box`.
function objectRoot(node: ESTree.Node): Option.Option<string> {
	if (node.type === 'Identifier') return Option.some(node.name)
	if (node.type === 'MemberExpression') return objectRoot(node.object)
	return Option.none()
}

function written(node: ESTree.Node) {
	if (node.type === 'AssignmentExpression') return objectRoot(node.left)
	if (node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')) {
		return objectRoot(node.argument)
	}
	return Option.none()
}

// Names, literals and the openings of calls, arrays and objects run no code, so a getter cannot run before the moved read.
function inert(token: Token) {
	if (Array.contains(['Boolean', 'Identifier', 'Null', 'Numeric', 'String'], token.type)) return true
	if (token.type === 'Keyword') return Array.contains(['const', 'return'], token.value)
	return token.type === 'Punctuator' && Array.contains(['(', ',', ':', '=', '[', '{'], token.value)
}

function replacement(input: {name: string; read: ESTree.Node; text: string}) {
	if (input.read.parent?.type === 'Property' && input.read.parent.shorthand) return `${input.name}: ${input.text}`
	return input.text
}

function report(input: {
	context: Context
	declaration: ESTree.VariableDeclaration
	init: ESTree.MemberExpression
	name: string
	node: ESTree.VariableDeclarator
	statements: ESTree.Statement[]
	variable: Variable
	writes: ESTree.Node[]
}) {
	const reads = pipe(
		input.variable.references,
		Array.filter(reference => reference.isRead()),
		Array.map(reference => reference.identifier)
	)
	const text = input.context.sourceCode.getText(input.init)
	pipe(
		rootName(input.init),
		Option.filter(
			root =>
				Array.isArrayNonEmpty(reads) &&
				Array.every(reads, read => {
					const used = outermost(read)
					return (
						read.parent.type !== 'ExportSpecifier' &&
						// TypeScript drops a property path's narrowing inside a callback, so a read there can need the alias.
						!enclosed({block: input.declaration.parent, node: read, types: functions}) &&
						// A called alias is a detached method, which runs without `this`.
						!(used.parent?.type === 'CallExpression' && used.parent.callee === used) &&
						!(used.parent?.type === 'TaggedTemplateExpression' && used.parent.tag === used) &&
						// A write to the same object before a read makes the alias a snapshot.
						!Array.some(
							input.writes,
							write =>
								between({declaration: input.declaration, node: write, read}) && Option.contains(written(write), root)
						) &&
						sameRoot({context: input.context, declarator: input.node, name: root, read})
					)
				})
		),
		Option.match({
			onNone: Function.constVoid,
			onSome: () =>
				input.context.report({
					fix: fixer => {
						// Inlining moves the property read to its use, so the use must run exactly once, in the next statement, after no code that can run a getter or change the property.
						if (
							reads.length !== 1 ||
							Array.some(
								reads,
								read =>
									// A JSX tag name also has a closing name.
									String.startsWith('JSX')(read.parent.type) ||
									enclosed({block: input.declaration.parent, node: read, types: deferred}) ||
									Array.some(input.statements, node => between({declaration: input.declaration, node, read})) ||
									!Array.every(input.context.sourceCode.getTokensBetween(input.declaration, read), inert)
							)
						) {
							return []
						}
						return [
							fixer.remove(input.declaration),
							...Array.map(reads, read => fixer.replaceText(read, replacement({name: input.name, read, text})))
						]
					},
					message: `Read ${text} where it is used; this name adds no value.`,
					node: input.node
				})
		})
	)
}

export const noPropertyAlias = defineRule({
	create: context => {
		const writes = MutableList.make<ESTree.Node>()
		const candidates = MutableList.make<{
			declaration: ESTree.VariableDeclaration
			init: ESTree.MemberExpression
			name: string
			node: ESTree.VariableDeclarator
			statements: ESTree.Statement[]
		}>()
		function write(node: ESTree.Node) {
			MutableList.append(writes, node)
		}
		return {
			AssignmentExpression: write,
			'Program:exit': () => {
				const nodes = MutableList.toArray(writes)
				for (const candidate of MutableList.toArray(candidates)) {
					pipe(
						variableFromScope({name: candidate.name, scope: context.sourceCode.getScope(candidate.node)}),
						Option.match({
							onNone: Function.constVoid,
							onSome: variable => report({...candidate, context, variable, writes: nodes})
						})
					)
				}
			},
			UnaryExpression: node => {
				if (node.operator === 'delete') write(node)
			},
			UpdateExpression: write,
			VariableDeclarator: node => {
				if (
					node.parent.type === 'VariableDeclaration' &&
					node.parent.kind === 'const' &&
					node.parent.declarations.length === 1 &&
					(node.parent.parent.type === 'BlockStatement' || node.parent.parent.type === 'StaticBlock') &&
					node.id.type === 'Identifier' &&
					node.id.typeAnnotation === null &&
					node.init?.type === 'MemberExpression' &&
					insideFunction(node.parent)
				) {
					MutableList.append(candidates, {
						declaration: node.parent,
						init: node.init,
						name: node.id.name,
						node,
						statements: node.parent.parent.body
					})
				}
			}
		}
	},
	meta: {fixable: 'code', type: 'problem'}
})
