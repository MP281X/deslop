import {Array, Option, Predicate, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {containsNode, importedMember, memberName, variableFromScope} from '#lib/ast.ts'

// The Effect functions that make an empty mutable collection, and the ones that add one item to it.
const EMPTY: Record.ReadonlyRecord<string, string[]> = {
	MutableHashMap: ['empty', 'make'],
	MutableHashSet: ['empty', 'make'],
	MutableList: ['make']
}
const ADD: Record.ReadonlyRecord<string, string[]> = {
	MutableHashMap: ['set'],
	MutableHashSet: ['add'],
	MutableList: ['append']
}

function effectCall(context: Context, node: ESTree.Node, functions: Record.ReadonlyRecord<string, string[]>) {
	if (node.type !== 'CallExpression' || node.callee.type === 'Super') return false
	const callee = node.callee
	return (
		callee.type === 'MemberExpression' &&
		Array.some(
			Record.toEntries(functions),
			entry =>
				importedMember({context, importedName: entry[0], node: callee}) &&
				Option.exists(memberName(callee), name => Array.contains(entry[1], name))
		)
	)
}

function isEmptyCollection(context: Context, node: ESTree.Expression) {
	if (node.type === 'ArrayExpression') return Array.isArrayEmpty(node.elements)
	if (node.type === 'ObjectExpression') return Array.isArrayEmpty(node.properties)
	return node.type === 'CallExpression' && Array.isArrayEmpty(node.arguments) && effectCall(context, node, EMPTY)
}

// `items.push(item)`, `items[key] = value` or `MutableList.append(items, item)`: one add into the collector.
function addTarget(context: Context, node: ESTree.Node) {
	if (node.type === 'AssignmentExpression') {
		if (node.operator !== '=' || node.left.type !== 'MemberExpression' || !node.left.computed) return Option.none()
		return Option.some<ESTree.Node>(node.left.object)
	}
	if (node.type !== 'CallExpression' || node.callee.type === 'Super') return Option.none()
	if (node.callee.type === 'MemberExpression' && Option.contains(memberName(node.callee), 'push')) {
		return Option.some<ESTree.Node>(node.callee.object)
	}
	if (!effectCall(context, node, ADD)) return Option.none()
	return Array.head(node.arguments)
}

function isAdd(input: {context: Context; name: string; node: ESTree.Node}) {
	return Option.exists(
		addTarget(input.context, input.node),
		target => target.type === 'Identifier' && target.name === input.name
	)
}

// A loop body that only adds into the collector, through loops over each item's parts and under at most one if with no else.
function fills(input: {context: Context; ifs: number; name: string; node: ESTree.Node}): boolean {
	if (input.node.type === 'BlockStatement') {
		return (
			Array.isArrayNonEmpty(input.node.body) &&
			Array.every(input.node.body, statement => fills({...input, node: statement}))
		)
	}
	if (input.node.type === 'IfStatement') {
		return input.ifs === 0 && input.node.alternate === null && fills({...input, ifs: 1, node: input.node.consequent})
	}
	if (input.node.type === 'ForOfStatement') return !input.node.await && fills({...input, node: input.node.body})
	if (input.node.type === 'ExpressionStatement') return isAdd({...input, node: input.node.expression})
	return isAdd(input)
}

// The body of a `for…of` loop, or of the callback of an `Array.forEach` statement.
function loopBody(context: Context, node: ESTree.Statement) {
	if (node.type === 'ForOfStatement') return Option.liftPredicate<ESTree.Node>(node.body, () => !node.await)
	if (
		node.type !== 'ExpressionStatement' ||
		node.expression.type !== 'CallExpression' ||
		node.expression.callee.type === 'Super' ||
		!importedMember({context, importedName: 'Array', node: node.expression.callee, propertyName: 'forEach'})
	) {
		return Option.none<ESTree.Node>()
	}
	return Option.flatMap(Array.last(node.expression.arguments), callback => {
		if (
			(callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') ||
			callback.body === null
		) {
			return Option.none()
		}
		return Option.some<ESTree.Node>(callback.body)
	})
}

// A reference outside the loop, or the target of an add: `items` in `items.push(item)`, `items[key] = value` or `MutableList.append(items, item)`.
function isAddTarget(input: {context: Context; identifier: ESTree.Node; name: string; node: ESTree.Node}) {
	if (input.identifier.range[0] < input.node.range[0] || input.identifier.range[1] > input.node.range[1]) return true
	return Option.exists(Option.fromNullishOr(input.identifier.parent), parent => {
		if (parent.type === 'MemberExpression' && parent.object === input.identifier) {
			return (
				((parent.parent.type === 'CallExpression' && parent.parent.callee === parent) ||
					(parent.parent.type === 'AssignmentExpression' && parent.parent.left === parent)) &&
				isAdd({...input, node: parent.parent})
			)
		}
		return (
			parent.type === 'CallExpression' && parent.arguments[0] === input.identifier && isAdd({...input, node: parent})
		)
	})
}

// Each read of the collector inside the loop is the target of an add, so every item is handled on its own.
function onlyAddsTo(input: {context: Context; declarator: ESTree.VariableDeclarator; name: string; node: ESTree.Node}) {
	return Option.exists(
		variableFromScope({name: input.name, scope: input.context.sourceCode.getScope(input.declarator)}),
		variable => Array.every(variable.references, reference => isAddTarget({...input, identifier: reference.identifier}))
	)
}

// `no-accumulating-copy` owns collectors copied in a reduce.
export const noLoopCollector = defineRule({
	create: context => ({
		BlockStatement: node => {
			Array.forEach(Array.zip(node.body, Array.drop(node.body, 1)), pair => {
				const declaration = pair[0]
				if (declaration.type !== 'VariableDeclaration' || declaration.declarations.length !== 1) return
				const declarator = declaration.declarations[0]
				if (declarator?.id.type !== 'Identifier' || Predicate.isNullish(declarator.init)) return
				if (!isEmptyCollection(context, declarator.init)) return
				const name = declarator.id.name
				const filled = Option.exists(
					loopBody(context, pair[1]),
					body =>
						fills({context, ifs: 0, name, node: body}) &&
						onlyAddsTo({context, declarator, name, node: body}) &&
						!containsNode({
							context,
							matches: inner => inner.type === 'AwaitExpression' || inner.type === 'YieldExpression',
							node: body,
							throughFunctions: false
						})
				)
				if (filled) {
					context.report({
						message:
							'Build the collection with one Array.map, filter, filterMap or flatMap, or Record.fromEntries for keys, instead of filling an empty collector in a loop.',
						node: pair[1]
					})
				}
			})
		}
	}),
	meta: {type: 'problem'}
})
