import {Array, Function, MutableList, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Variable} from 'vite-plus/lint/plugins'

import {inert, matches, outermost, rootName, variableFromScope} from '#rules/shared.ts'

const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

function insideFunction(node: ESTree.Node): boolean {
	if (Predicate.isNullish(node.parent) || node.parent.type === 'Program') return false
	if (Array.contains(FUNCTIONS, node.parent.type)) return true
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

// `note` in `note.image.length` reads the path `note.image.length`.
function pathTop(node: ESTree.Node): ESTree.Node {
	if (node.parent?.type === 'MemberExpression' && node.parent.object === node && !node.parent.computed) {
		return pathTop(node.parent)
	}
	return node
}

// `isText`, `Predicate.isString`, `Option.isSome` and the curried `Schema.is(Schema.String)` read as predicates.
function predicate(callee: ESTree.Node): boolean {
	if (callee.type === 'CallExpression') return predicate(callee.callee)
	if (callee.type === 'Identifier') return matches(/^(?:has|is)(?:[A-Z]|$)/u)(callee.name)
	return (
		callee.type === 'MemberExpression' &&
		callee.property.type === 'Identifier' &&
		matches(/^(?:has|is)(?:[A-Z]|$)/u)(callee.property.name)
	)
}

// A comparison, a negation, a condition or a predicate call on a path narrows it; the right side of `a && b` passes its value on to whatever tests it.
function tested(node: ESTree.Node): boolean {
	if (Predicate.isNullish(node.parent)) return false
	if (node.parent.type === 'LogicalExpression') return node.parent.left === node || tested(node.parent)
	if (Array.contains(['ChainExpression', 'TSAsExpression', 'TSNonNullExpression'], node.parent.type)) {
		return tested(node.parent)
	}
	return (
		(node.parent.type === 'BinaryExpression' &&
			Array.contains(['!=', '!==', '==', '===', 'in', 'instanceof'], node.parent.operator)) ||
		(node.parent.type === 'UnaryExpression' && Array.contains(['!', 'typeof'], node.parent.operator)) ||
		(node.parent.type === 'ConditionalExpression' && node.parent.test === node) ||
		(node.parent.type === 'IfStatement' && node.parent.test === node) ||
		(node.parent.type === 'SwitchStatement' && node.parent.discriminant === node) ||
		// Any call can be a type guard, so an argument counts as tested when the call is, or when the callee reads as a predicate.
		(node.parent.type === 'CallExpression' &&
			node.parent.callee !== node &&
			// `schema` in `Schema.is(schema)(value)` builds the predicate; only `value` is tested.
			!(node.parent.parent.type === 'CallExpression' && node.parent.parent.callee === node.parent) &&
			(predicate(node.parent.callee) || tested(node.parent)))
	)
}

// A callback that is not passed straight to a call may run after the property changes, so its alias is a snapshot.
function deferred(input: {block: ESTree.Node; node: ESTree.Node}): boolean {
	if (Predicate.isNullish(input.node.parent) || input.node.parent === input.block) return false
	const parent = input.node.parent
	if (
		Array.contains(FUNCTIONS, parent.type) &&
		!(parent.parent?.type === 'CallExpression' && Array.some(parent.parent.arguments, argument => argument === parent))
	) {
		return true
	}
	return deferred({...input, node: parent})
}

function enclosed(input: {block: ESTree.Node; node: ESTree.Node; types: string[]}): boolean {
	if (Predicate.isNullish(input.node.parent) || input.node.parent === input.block) return false
	if (Array.contains(input.types, input.node.parent.type)) return true
	return enclosed({...input, node: input.node.parent})
}

// TypeScript keeps a narrowed alias inside a callback but drops a narrowed property path, so the alias is needed only when a callback reads a path that a check narrowed, or when a check before the alias narrowed its property.
function needsAlias(input: {context: Context; declaration: ESTree.VariableDeclaration; reads: ESTree.Node[]}) {
	if (
		input.declaration.parent.type !== 'BlockStatement' ||
		!Array.contains(FUNCTIONS, input.declaration.parent.parent.type) ||
		!pipe(
			input.declaration.parent.body,
			Array.takeWhile(statement => statement !== input.declaration),
			Array.every(statement => statement.type === 'VariableDeclaration')
		)
	) {
		return true
	}
	const block = input.declaration.parent
	const paths = Array.map(input.reads, read => ({
		callback: enclosed({block, node: read, types: FUNCTIONS}),
		node: pathTop(read),
		text: input.context.sourceCode.getText(pathTop(read))
	}))
	const callbacks = Array.filter(paths, path => path.callback)
	if (Array.isArrayEmpty(callbacks)) return false
	return Array.some(
		paths,
		checked =>
			tested(checked.node) &&
			Array.some(callbacks, read => read.text === checked.text || String.startsWith(`${checked.text}.`)(read.text))
	)
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
	const aliasRequired = needsAlias({context: input.context, declaration: input.declaration, reads})
	pipe(
		rootName(input.init),
		Option.filter(
			root =>
				Array.isArrayNonEmpty(reads) &&
				Array.every(reads, read => {
					const used = outermost(read)
					return (
						read.parent.type !== 'ExportSpecifier' &&
						(!aliasRequired || !enclosed({block: input.declaration.parent, node: read, types: FUNCTIONS})) &&
						!deferred({block: input.declaration.parent, node: read}) &&
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
									// A read inside a callback, a loop or a branch runs a different number of times than the declaration.
									enclosed({
										block: input.declaration.parent,
										node: read,
										types: [
											...FUNCTIONS,
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
									}) ||
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
					message: `Read ${text} where it is used; TypeScript narrows the property path just as it narrows the alias.`,
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
					node.parent.parent.type === 'ExportNamedDeclaration' &&
					node.id.type === 'Identifier' &&
					node.init?.type === 'MemberExpression'
				) {
					const init = node.init
					pipe(
						rootName(init),
						Option.flatMap(root => variableFromScope({name: root, scope: context.sourceCode.getScope(node)})),
						Option.filter(variable => Array.every(variable.defs, definition => definition.type === 'Variable')),
						Option.match({
							onNone: Function.constVoid,
							onSome: variable =>
								context.report({
									message: `Export ${variable.name} and read ${context.sourceCode.getText(init)} where it is used.`,
									node
								})
						})
					)
				}
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
