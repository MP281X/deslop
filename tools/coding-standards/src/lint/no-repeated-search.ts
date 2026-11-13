import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	importedMember,
	isFunction,
	isImportBinding,
	memberName,
	rootName,
	typeWrapped,
	variableFromScope
} from '#lib/ast.ts'

// Effect's Array functions that look one item up by testing each with a callback.
const SEARCHES = ['every', 'filter', 'findFirst', 'findFirstIndex', 'findLast', 'findLastIndex', 'some']
// The same searches as array methods.
const NATIVE_SEARCHES = ['every', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some']
// Array methods that test by equality; strings have them too, so only a collection typed as an array counts.
const NATIVE_CONTAINS = ['includes', 'indexOf', 'lastIndexOf']
// Effect's Array functions that call their callback once per item.
const ITERATIONS = [
	'every',
	'filter',
	'filterMap',
	'findFirst',
	'flatMap',
	'forEach',
	'groupBy',
	'map',
	'partition',
	'some',
	'sortBy'
]
// The array methods that call their callback once per item.
const NATIVE_ITERATIONS = ['every', 'filter', 'find', 'findIndex', 'flatMap', 'forEach', 'map', 'reduce', 'some']

function isArrayCall(context: Context, node: ESTree.Node | null, names: string[]) {
	return (
		node?.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Array', node: node.callee}) &&
		Option.exists(memberName(node.callee), name => Array.contains(names, name))
	)
}

// `items.name(…)` on a value of the file's own, never a module it imports such as Option or Effect.
function isMethodCall(context: Context, node: ESTree.Node | null, names: string[]) {
	if (node?.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false
	return (
		Option.exists(memberName(node.callee), name => Array.contains(names, name)) &&
		!(node.callee.object.type === 'Identifier' && isImportBinding({context, node: node.callee.object, source: /./u}))
	)
}

// The collection a curried call is applied to: `Array.findFirst(test)(items)` or `pipe(items, Array.findFirst(test))`.
function appliedTo(context: Context, node: ESTree.CallExpression) {
	if (node.parent.type !== 'CallExpression') return Option.none<ESTree.Node>()
	if (node.parent.callee === node && node.parent.arguments.length === 1) return Array.head(node.parent.arguments)
	if (
		node.parent.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: node.parent.callee, source: 'effect'}) &&
		node.parent.arguments[1] === node
	) {
		return Array.head(node.parent.arguments)
	}
	return Option.none()
}

// The function or loop that runs once per item and binds `name`: the parameter of a callback an Effect Array iteration or an array method calls once per item, or a `for…of` variable.
function perItem(context: Context, node: ESTree.Node, name: string) {
	return pipe(
		variableFromScope({name, scope: context.sourceCode.getScope(node)}),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.flatMap(definition => {
			if (definition.type === 'Parameter' && isFunction(definition.node)) {
				return Option.liftPredicate<ESTree.Node>(
					definition.node,
					callback =>
						isArrayCall(context, callback.parent, ITERATIONS) ||
						isMethodCall(context, callback.parent, NATIVE_ITERATIONS)
				)
			}
			if (definition.type !== 'Variable' || definition.parent?.type !== 'VariableDeclaration') return Option.none()
			return Option.liftPredicate<ESTree.Node>(definition.parent.parent, loop => loop.type === 'ForOfStatement')
		})
	)
}

// `item => item.key === outer.key` or `id => id === outer.id`, with `item` the search callback's own parameter: the other side is the per-item value it matches.
function keyOf(search?: ESTree.Node) {
	if (search?.type !== 'ArrowFunctionExpression') return Option.none<ESTree.Node>()
	const parameter = search.params[0]
	if (search.params.length !== 1 || parameter?.type !== 'Identifier') return Option.none()
	if (search.body.type !== 'BinaryExpression' || !Array.contains(['===', '=='], search.body.operator)) {
		return Option.none()
	}
	const sides = [search.body.left, search.body.right]
	const own = Array.filter(sides, side => Option.contains(rootName(side), parameter.name))
	const others = Array.filter(
		sides,
		side => Option.isSome(rootName(side)) && !Option.contains(rootName(side), parameter.name)
	)
	if (own.length !== 1 || others.length !== 1) return Option.none()
	return Array.head(others)
}

function inside(node: ESTree.Node, outer: ESTree.Node) {
	return node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1]
}

// The items the loop walks, when the loop names them.
function walked(context: Context, loop: ESTree.Node) {
	if (loop.type === 'ForOfStatement') return Option.some<ESTree.Node>(loop.right)
	if (loop.parent?.type !== 'CallExpression') return Option.none<ESTree.Node>()
	if (isMethodCall(context, loop.parent, NATIVE_ITERATIONS) && loop.parent.callee.type === 'MemberExpression') {
		return Option.some<ESTree.Node>(loop.parent.callee.object)
	}
	if (loop.parent.arguments.length === 2) return Array.head(loop.parent.arguments)
	return appliedTo(context, loop.parent)
}

// Any identifier the parser gives, as a searched collection is read from several node types.
type Identifier = Extract<ESTree.Node, {type: 'Identifier'}>

function definitionsOf(context: Context, collection: Identifier) {
	return variableFromScope({name: collection.name, scope: context.sourceCode.getScope(collection)})
}

// An array literal written in the code is a small fixed lookup table, cheaper to search than to index.
function isFixedTable(context: Context, collection: Identifier) {
	return Option.exists(
		definitionsOf(context, collection),
		variable =>
			Array.isArrayNonEmpty(variable.defs) &&
			Array.every(variable.defs, definition => {
				if (definition.type !== 'Variable' || definition.node.type !== 'VariableDeclarator') return false
				const init = definition.node.init
				return init !== null && Option.getOrElse(typeWrapped(init), () => init).type === 'ArrayExpression'
			})
	)
}

// `T[]`, `readonly T[]`, `Array<T>` or `ReadonlyArray<T>`.
function isArrayType(type?: ESTree.TSType | null): boolean {
	if (type?.type === 'TSTypeOperator') return isArrayType(type.typeAnnotation)
	return (
		type?.type === 'TSArrayType' ||
		(type?.type === 'TSTypeReference' &&
			type.typeName.type === 'Identifier' &&
			Array.contains(['Array', 'ReadonlyArray'], type.typeName.name))
	)
}

// A binding written with an array type, as a string's includes is not a search.
function isTypedArray(context: Context, collection: Identifier) {
	return Option.exists(definitionsOf(context, collection), variable =>
		Array.some(variable.defs, definition => isArrayType(definition.name.typeAnnotation?.typeAnnotation))
	)
}

// A collection bound outside the per-item code and never written inside it: the same items for every search. Comparing the walked items with each other is pairwise work, left to review.
function unchangedOutside(context: Context, collection: Identifier, loop: ESTree.Node) {
	if (Option.exists(walked(context, loop), items => context.sourceCode.getText(items) === collection.name)) return false
	return Option.exists(
		definitionsOf(context, collection),
		variable =>
			Array.isArrayNonEmpty(variable.defs) &&
			Array.every(variable.defs, definition => !inside(definition.name, loop)) &&
			Array.every(variable.references, reference => !reference.isWrite() || !inside(reference.identifier, loop))
	)
}

// A search's collection and the value it matches, when the call names both.
function searched(collection?: ESTree.Node, outer?: ESTree.Node) {
	return Option.all({collection: Option.fromNullishOr(collection), outer: Option.fromNullishOr(outer)})
}

// The collection a call searches and the value it matches: a search by an equality key, or a test of membership, data-first, curried or as an array method.
function searchOf(context: Context, node: ESTree.CallExpression) {
	const first = node.arguments[0]
	const second = node.arguments[1]
	if (isArrayCall(context, node, SEARCHES)) {
		if (node.arguments.length === 2) return Option.flatMap(keyOf(second), outer => searched(first, outer))
		return Option.flatMap(keyOf(first), outer =>
			Option.flatMap(appliedTo(context, node), collection => searched(collection, outer))
		)
	}
	if (isArrayCall(context, node, ['contains'])) {
		if (node.arguments.length === 2) return searched(first, second)
		return Option.flatMap(appliedTo(context, node), collection => searched(collection, first))
	}
	if (node.callee.type !== 'MemberExpression' || node.arguments.length !== 1) return Option.none()
	const receiver = node.callee.object
	if (isMethodCall(context, node, NATIVE_SEARCHES)) {
		return Option.flatMap(keyOf(first), outer => searched(receiver, outer))
	}
	if (
		isMethodCall(context, node, NATIVE_CONTAINS) &&
		receiver.type === 'Identifier' &&
		isTypedArray(context, receiver)
	) {
		return searched(receiver, first)
	}
	return Option.none()
}

// Only an equality key is indexed safely; a search the key alone cannot answer, or one over a collection the loop changes, stays with review.
export const noRepeatedSearch = defineRule({
	create: context => ({
		CallExpression: node => {
			const repeated = Option.exists(searchOf(context, node), found => {
				const collection = found.collection
				if (collection.type !== 'Identifier') return false
				return pipe(
					rootName(found.outer),
					Option.flatMap(name => perItem(context, found.outer, name)),
					Option.exists(
						loop =>
							inside(node, loop) && unchangedOutside(context, collection, loop) && !isFixedTable(context, collection)
					)
				)
			})
			if (repeated) {
				context.report({
					message:
						'Index the collection once before the loop (a HashSet, Array.groupBy, Record.fromEntries or a HashMap) instead of searching it for each item.',
					node
				})
			}
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Array, HashSet} from 'effect'
export function selectedNotes(notes: readonly {id: string}[], ids: readonly string[]) {
const selected = HashSet.fromIterable(ids)
return Array.filter(notes, note => HashSet.has(selected, note.id))
}`
					}
				]
			}
		},
		type: 'suggestion'
	}
})
