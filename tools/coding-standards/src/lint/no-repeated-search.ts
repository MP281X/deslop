import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isFunction, memberName, rootName, variableFromScope} from '#lib/ast.ts'

// Effect's Array functions that look one item up by testing each.
const SEARCHES = ['every', 'filter', 'findFirst', 'findFirstIndex', 'findLast', 'findLastIndex', 'some']
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

function isArrayCall(context: Context, node: ESTree.Node | null, names: string[]): node is ESTree.CallExpression {
	return (
		node?.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Array', node: node.callee}) &&
		Option.exists(memberName(node.callee), name => Array.contains(names, name))
	)
}

// The function or loop that runs once per item and binds `name`: an iteration callback's parameter or a `for…of` variable.
function perItem(context: Context, node: ESTree.Node, name: string) {
	return pipe(
		variableFromScope({name, scope: context.sourceCode.getScope(node)}),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.flatMap(definition => {
			if (definition.type === 'Parameter' && isFunction(definition.node)) {
				return Option.liftPredicate<ESTree.Node>(definition.node, callback =>
					isArrayCall(context, callback.parent, ITERATIONS)
				)
			}
			if (definition.type !== 'Variable' || definition.parent?.type !== 'VariableDeclaration') return Option.none()
			return Option.liftPredicate<ESTree.Node>(definition.parent.parent, loop => loop.type === 'ForOfStatement')
		})
	)
}

// `item.key === outer.key` with `item` the search callback's own parameter: the other side names the per-item value it matches.
function matchedOuter(search: ESTree.Node) {
	if (search.type !== 'ArrowFunctionExpression') return Option.none()
	const parameter = search.params[0]
	if (search.params.length !== 1 || parameter?.type !== 'Identifier') return Option.none()
	if (search.body.type !== 'BinaryExpression' || search.body.operator !== '===') return Option.none()
	const sides = [search.body.left, search.body.right]
	if (!Array.every(sides, side => side.type === 'MemberExpression')) return Option.none()
	return pipe(
		sides,
		Array.filter(side => !Option.contains(rootName(side), parameter.name)),
		Array.match({
			onEmpty: () => Option.none(),
			onNonEmpty: others => Option.liftPredicate(Array.headNonEmpty(others), () => others.length === 1)
		})
	)
}

function inside(node: ESTree.Node, outer: ESTree.Node) {
	return node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1]
}

// The items the loop walks, when the call or the `for…of` names them.
function walked(loop: ESTree.Node) {
	if (loop.type === 'ForOfStatement') return Option.some<ESTree.Node>(loop.right)
	if (loop.parent?.type !== 'CallExpression' || loop.parent.arguments.length !== 2) return Option.none()
	return Option.fromNullishOr(loop.parent.arguments[0])
}

// A collection bound outside the per-item code and never written inside it: the same items for every search. Comparing the walked items with each other is pairwise work, left to review.
function unchangedOutside(context: Context, collection: ESTree.Node, loop: ESTree.Node) {
	if (collection.type !== 'Identifier') return false
	if (Option.exists(walked(loop), items => context.sourceCode.getText(items) === collection.name)) return false
	return Option.exists(
		variableFromScope({name: collection.name, scope: context.sourceCode.getScope(collection)}),
		variable =>
			Array.isArrayNonEmpty(variable.defs) &&
			Array.every(variable.defs, definition => !inside(definition.name, loop)) &&
			Array.every(variable.references, reference => !reference.isWrite() || !inside(reference.identifier, loop))
	)
}

// Only an equality key is indexed safely; a search the key alone cannot answer, or one over a collection the loop changes, stays with review.
export const noRepeatedSearch = defineRule({
	create: context => ({
		CallExpression: node => {
			if (!isArrayCall(context, node, SEARCHES) || node.arguments.length !== 2) return
			const collection = node.arguments[0]
			const search = node.arguments[1]
			if (Predicate.isUndefined(collection) || Predicate.isUndefined(search)) return
			const repeated = pipe(
				matchedOuter(search),
				Option.flatMap(outer => Option.map(rootName(outer), name => ({name, outer}))),
				Option.flatMap(found => perItem(context, found.outer, found.name)),
				Option.exists(loop => inside(node, loop) && unchangedOutside(context, collection, loop))
			)
			if (repeated) {
				context.report({
					message:
						'Index the collection once before the loop (Array.groupBy, Record.fromEntries or a HashMap) instead of searching it for each item.',
					node
				})
			}
		}
	}),
	meta: {type: 'suggestion'}
})
