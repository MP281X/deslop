import {Array, Option, Predicate, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isFunction, memberName, variableFromScope, variableOf} from '#lib/ast.ts'

const BUILDERS: Record.ReadonlyRecord<string, string[]> = {
	MutableHashMap: ['set'],
	MutableHashSet: ['add'],
	MutableList: ['append', 'prepend']
}

function target(context: Context, node: ESTree.Node) {
	if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.computed) {
		return Option.some(node.left.object)
	}
	if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return Option.none<ESTree.Node>()
	if (Option.exists(memberName(node.callee), name => Array.contains(['push', 'unshift', 'splice'], name))) {
		return Option.some(node.callee.object)
	}
	if (
		Array.some(
			Record.toEntries(BUILDERS),
			entry =>
				node.callee.type === 'MemberExpression' &&
				importedMember({context, importedName: entry[0], node: node.callee}) &&
				Option.exists(memberName(node.callee), name => Array.contains(entry[1], name))
		)
	) {
		return Array.head(node.arguments)
	}
	return Option.none()
}

function loop(context: Context, node: ESTree.Node): Option.Option<ESTree.Node> {
	if (Predicate.isNullish(node.parent)) return Option.none()
	if (
		Array.contains(
			['ForOfStatement', 'ForInStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement'],
			node.parent.type
		)
	) {
		return Option.some(node.parent)
	}
	if (
		node.parent.type === 'CallExpression' &&
		importedMember({context, importedName: 'Array', node: node.parent.callee, propertyName: 'forEach'})
	) {
		return Option.some(node.parent)
	}
	return loop(context, node.parent)
}

export function collectingLoop(context: Context, node: ESTree.Node) {
	return pipe(
		target(context, node),
		Option.filter((collector): collector is ESTree.IdentifierReference => collector.type === 'Identifier'),
		Option.flatMap(collector =>
			variableFromScope({name: collector.name, scope: context.sourceCode.getScope(collector)})
		),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.filter(
			definition =>
				definition.type === 'Parameter' ||
				(definition.type === 'Variable' &&
					definition.node.type === 'VariableDeclarator' &&
					definition.node.init !== null &&
					(definition.node.init.type === 'ArrayExpression' ||
						definition.node.init.type === 'ObjectExpression' ||
						(definition.node.init.type === 'CallExpression' &&
							definition.node.init.callee.type === 'MemberExpression' &&
							Option.exists(memberName(definition.node.init.callee), name => Array.contains(['empty', 'make'], name)))))
		),
		Option.flatMap(() => loop(context, node)),
		Option.isSome
	)
}

// The generator of Effect.gen, Effect.fnUntraced or Effect.fn(…), stopping at the nearest function.
function effectGenerator(context: Context, node: ESTree.Node): boolean {
	if (node.type === 'FunctionExpression' && node.generator && node.parent.type === 'CallExpression') {
		return (
			importedMember({context, importedName: 'Effect', node: node.parent.callee, propertyName: 'gen'}) ||
			importedMember({context, importedName: 'Effect', node: node.parent.callee, propertyName: 'fnUntraced'}) ||
			(node.parent.callee.type === 'CallExpression' &&
				importedMember({context, importedName: 'Effect', node: node.parent.callee.callee, propertyName: 'fn'}))
		)
	}
	if (isFunction(node) || node.parent === null) return false
	return effectGenerator(context, node.parent)
}

// The for-of whose body is this statement, alone or as its block's one statement.
function soleBodyOf(statement: ESTree.ExpressionStatement) {
	if (statement.parent.type === 'BlockStatement' && statement.parent.body.length === 1) return statement.parent.parent
	return statement.parent
}

// effecttsgo/for-loop-push-to-for-each owns, with its Effect.forEach fix, a `for (const … of …)` in an Effect generator whose one statement is `acc.push(yield* effect)` into a `const acc = []` its block declares before the loop and leaves unread until it.
function effectForEachLoop(context: Context, node: ESTree.CallExpression) {
	if (
		node.callee.type !== 'MemberExpression' ||
		node.callee.object.type !== 'Identifier' ||
		!Option.contains(memberName(node.callee), 'push') ||
		node.arguments.length !== 1 ||
		node.arguments[0]?.type !== 'YieldExpression' ||
		!node.arguments[0].delegate ||
		node.parent.type !== 'ExpressionStatement'
	) {
		return false
	}
	const forOf = soleBodyOf(node.parent)
	if (forOf.type !== 'ForOfStatement' || forOf.await || forOf.left.type !== 'VariableDeclaration') return false
	if (forOf.left.kind !== 'const' || forOf.parent.type !== 'BlockStatement' || !effectGenerator(context, forOf)) {
		return false
	}
	return Option.exists(variableOf(context, node.callee.object), variable =>
		Option.exists(
			Array.head(variable.defs),
			definition =>
				definition.node.type === 'VariableDeclarator' &&
				definition.node.init?.type === 'ArrayExpression' &&
				Array.isArrayEmpty(definition.node.init.elements) &&
				definition.node.parent.type === 'VariableDeclaration' &&
				definition.node.parent.kind === 'const' &&
				definition.node.parent.parent === forOf.parent &&
				definition.node.range[1] <= forOf.range[0] &&
				!Array.some(
					variable.references,
					reference =>
						reference.identifier.range[0] > definition.node.range[1] && reference.identifier.range[0] < forOf.range[0]
				)
		)
	)
}

export const noCollectingLoop = defineRule({
	create: context => {
		function check(node: ESTree.Node) {
			if (!collectingLoop(context, node)) return
			if (node.type === 'CallExpression' && effectForEachLoop(context, node)) return
			context.report({
				message:
					'Build the collection with Array.map, filterMap, flatMap, partition or Record.fromEntries; use Array.mapAccum when an item depends on earlier items, and Effect.forEach for effectful work.',
				node
			})
		}
		return {AssignmentExpression: check, CallExpression: check}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Array} from 'effect'
export function noteIds(notes: readonly {id: string}[]) { return Array.map(notes, note => note.id) }`
					}
				]
			}
		},
		type: 'problem'
	}
})
