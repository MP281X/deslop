import {Array, Function, MutableList, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {redundantConstAlias} from '#rules/no-trivial-indirection.ts'
import {
	childNodes,
	inert,
	isSchemaOperationCall,
	outermost,
	readable,
	rootName,
	suspends,
	typeWrapped,
	variableFromScope
} from '#rules/shared.ts'

const REPEATING = [
	'ArrowFunctionExpression',
	'DoWhileStatement',
	'ForInStatement',
	'ForOfStatement',
	'ForStatement',
	'FunctionDeclaration',
	'FunctionExpression',
	'WhileStatement'
]

// Loops, callbacks, conditionals, short-circuits and optional chains can repeat or skip the read; a loop's iterable, a test and a short-circuit's left side run once.
function climb(input: {node: ESTree.Node; statement: ESTree.Node}): boolean {
	if (input.node === input.statement) return true
	if (Predicate.isNullish(input.node.parent)) return false
	if (
		((input.node.parent.type === 'ForOfStatement' || input.node.parent.type === 'ForInStatement') &&
			input.node.parent.right === input.node) ||
		(input.node.parent.type === 'IfStatement' && input.node.parent.test === input.node) ||
		(input.node.parent.type === 'ConditionalExpression' && input.node.parent.test === input.node) ||
		(input.node.parent.type === 'LogicalExpression' && input.node.parent.left === input.node)
	) {
		return climb({...input, node: input.node.parent})
	}
	if (
		Array.contains(REPEATING, input.node.parent.type) ||
		input.node.parent.type === 'IfStatement' ||
		input.node.parent.type === 'ConditionalExpression' ||
		input.node.parent.type === 'LogicalExpression' ||
		input.node.parent.type === 'ChainExpression' ||
		input.node.parent.type === 'SwitchStatement' ||
		input.node.parent.type === 'TryStatement'
	) {
		return false
	}
	return climb({...input, node: input.node.parent})
}

function insideConditional(input: {node: ESTree.Node; statement: ESTree.Node}): boolean {
	if (input.node === input.statement) return false
	if (input.node.type === 'ConditionalExpression') return true
	return Predicate.isNotNullish(input.node.parent) && insideConditional({...input, node: input.node.parent})
}

function unwrapped(node: ESTree.Node): ESTree.Node {
	return pipe(typeWrapped(node), Option.match({onNone: () => node, onSome: unwrapped}))
}

function candidate(context: Context, node: ESTree.VariableDeclarator) {
	return (
		node.parent.type === 'VariableDeclaration' &&
		node.parent.kind === 'const' &&
		node.parent.declarations.length === 1 &&
		node.parent.parent.type === 'BlockStatement' &&
		node.id.type === 'Identifier' &&
		node.id.typeAnnotation === null &&
		node.init !== null &&
		// Functions and aliases belong to the indirection check, property chains to the alias check, plain literals to the literal check, elements to no-stored-jsx and Schema operations to no-stored-schema-operation.
		!redundantConstAlias({context, node}) &&
		!Array.contains(
			['ArrowFunctionExpression', 'FunctionExpression', 'JSXElement', 'JSXFragment'],
			unwrapped(node.init).type
		) &&
		!(node.init.type === 'CallExpression' && isSchemaOperationCall({context, node: node.init})) &&
		!(node.init.type === 'MemberExpression' && Option.isSome(rootName(node.init))) &&
		!(node.init.type === 'Literal' && !Predicate.hasProperty(node.init, 'regex')) &&
		!(node.init.type === 'TemplateLiteral' && Array.isArrayEmpty(node.init.expressions))
	)
}

// A detached method keeps no receiver, and an anonymous class takes its name from the binding.
function fixable(input: {init: ESTree.Expression; read: ESTree.Node}) {
	const read = outermost(input.read)
	return !(
		unwrapped(input.init).type === 'ClassExpression' ||
		(read.parent?.type === 'CallExpression' && read.parent.callee === read) ||
		(read.parent?.type === 'TaggedTemplateExpression' && read.parent.tag === read)
	)
}

// The value always moves in parentheses; the formatter that runs after the fix drops the redundant ones.
function inlined(input: {
	context: Context
	init: ESTree.Expression
	name: string
	next: ESTree.Node
	read: ESTree.Node
}) {
	const value = `(${input.context.sourceCode.getText(input.init)})`
	if (input.read.parent?.type === 'Property' && input.read.parent.shorthand) return `${input.name}: ${value}`
	// A statement that now starts with a parenthesis continues the previous line without a semicolon.
	if (input.read.range[0] === input.next.range[0]) return `;${value}`
	return value
}

// A value that runs code must run before anything that runs before its new place, such as a getter on the way to the read.
function executes(context: Context, node: ESTree.Node): boolean {
	if (
		Array.contains(
			[
				'AwaitExpression',
				'CallExpression',
				'MemberExpression',
				'NewExpression',
				'SpreadElement',
				'TaggedTemplateExpression',
				'YieldExpression'
			],
			node.type
		)
	) {
		return true
	}
	if (Array.contains(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'], node.type)) return false
	return Array.some(childNodes(context, node), child => executes(context, child))
}

// The read is the object a method is called on, as `client` in `client.trace(id)`.
function receiver(read: ESTree.Node) {
	return (
		read.parent?.type === 'MemberExpression' &&
		read.parent.object === read &&
		read.parent.parent.type === 'CallExpression' &&
		read.parent.parent.callee === read.parent
	)
}

function report(input: {context: Context; effects: ESTree.Node[]; node: ESTree.VariableDeclarator}) {
	const declaration = input.node.parent
	const init = input.node.init
	if (
		declaration.type !== 'VariableDeclaration' ||
		declaration.parent.type !== 'BlockStatement' ||
		input.node.id.type !== 'Identifier' ||
		init === null
	) {
		return
	}
	const statements = declaration.parent.body
	const name = input.node.id.name
	pipe(
		Array.findFirstIndex(statements, statement => statement === declaration),
		Option.flatMap(index => Array.get(statements, index + 1)),
		Option.flatMap(next =>
			pipe(
				variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)}),
				Option.map(variable => Array.filter(variable.references, reference => reference.isRead())),
				Option.filter(reads => reads.length === 1),
				Option.flatMap(Array.head),
				Option.map(reference => reference.identifier),
				Option.filter(
					read =>
						read.range[0] >= next.range[0] &&
						read.range[1] <= next.range[1] &&
						climb({node: read, statement: next}) &&
						readable({context: input.context, init, read}) &&
						// Inlining a conditional value into another conditional would nest ternaries, which lint forbids.
						!(init.type === 'ConditionalExpression' && insideConditional({node: read, statement: next})) &&
						// `yield* client.trace(id)` reads better than `yield* (yield* RpcClient.make(Rpcs)).trace(id)`.
						!(suspends(input.context, init) && receiver(outermost(read))) &&
						// Moving the value past code that runs first would change what it reads or reorder effects.
						!Array.some(input.effects, effect => effect.range[0] >= next.range[0] && effect.range[1] <= read.range[0])
				),
				Option.map(read => ({next, read}))
			)
		),
		Option.match({
			onNone: Function.constVoid,
			onSome: found =>
				input.context.report({
					fix: fixer => {
						if (
							!fixable({init, read: found.read}) ||
							(executes(input.context, init) &&
								!Array.every(input.context.sourceCode.getTokensBetween(declaration, found.read), inert))
						) {
							return []
						}
						return [
							fixer.remove(declaration),
							fixer.replaceText(found.read, inlined({context: input.context, init, name, ...found}))
						]
					},
					message: 'Inline this value into the next statement, its only use.',
					node: input.node
				})
		})
	)
}

export const noSingleUseValue = defineRule({
	create: context => {
		const effects = MutableList.make<ESTree.Node>()
		const candidates = MutableList.make<ESTree.VariableDeclarator>()
		function effect(node: ESTree.Node) {
			MutableList.append(effects, node)
		}
		return {
			AssignmentExpression: effect,
			AwaitExpression: effect,
			CallExpression: effect,
			NewExpression: effect,
			'Program:exit': () => {
				const nodes = MutableList.toArray(effects)
				for (const node of MutableList.toArray(candidates)) report({context, effects: nodes, node})
			},
			TaggedTemplateExpression: effect,
			UpdateExpression: effect,
			VariableDeclarator: node => {
				if (candidate(context, node)) MutableList.append(candidates, node)
			},
			YieldExpression: effect
		}
	},
	meta: {fixable: 'code', type: 'problem'}
})
