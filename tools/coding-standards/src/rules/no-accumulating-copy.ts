import {Array, MutableHashSet, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Reference} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName, variableFromScope} from '#rules/shared.ts'

function copyingMethod(context: Context, node: ESTree.Node) {
	if (node.type !== 'MemberExpression' || node.optional) return Option.none<{arity: number; both: boolean}>()
	if (importedMember({context, importedName: 'Record', node, propertyName: 'set'})) {
		return Option.some({arity: 3, both: false})
	}
	if (!importedMember({context, importedName: 'Array', node})) return Option.none<{arity: number; both: boolean}>()
	const name = memberName(node)
	if (Option.exists(name, method => method === 'append' || method === 'prepend')) {
		return Option.some({arity: 2, both: false})
	}
	if (Option.exists(name, method => method === 'appendAll' || method === 'prependAll')) {
		return Option.some({arity: 2, both: true})
	}
	return Option.none<{arity: number; both: boolean}>()
}

function dataLastOperation(context: Context, node: ESTree.CallExpression) {
	if (node.callee.type === 'CallExpression') return Option.some<ESTree.CallExpression>(node.callee)
	if (
		node.callee.type === 'Identifier' &&
		node.arguments[1]?.type === 'CallExpression' &&
		isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	) {
		return Option.some<ESTree.CallExpression>(node.arguments[1])
	}
	return Option.none<ESTree.CallExpression>()
}

function copiedArguments(context: Context, node: ESTree.CallExpression) {
	const method = Option.getOrUndefined(copyingMethod(context, node.callee))
	if (method !== undefined && node.arguments.length === method.arity) {
		if (method.both) return node.arguments
		return Array.take(node.arguments, 1)
	}
	const operation = Option.getOrUndefined(dataLastOperation(context, node))
	const self = node.arguments[0]
	if (operation === undefined || self === undefined) return Array.empty<ESTree.Node>()
	const applied = Option.getOrUndefined(copyingMethod(context, operation.callee))
	if (applied === undefined || operation.arguments.length + 1 !== applied.arity) return Array.empty<ESTree.Node>()
	if (applied.both) return [self, ...operation.arguments]
	return [self]
}

function copySite(context: Context, node: Reference['identifier']) {
	if (node.parent.type === 'SpreadElement') {
		if (node.parent.parent.type === 'ArrayExpression') return Option.some<ESTree.Node>(node.parent.parent)
		if (
			node.parent.parent.type === 'ObjectExpression' &&
			Array.some(node.parent.parent.properties, property => property.type === 'Property' && property.computed)
		) {
			return Option.some<ESTree.Node>(node.parent.parent)
		}
	}
	return Array.findFirst([node.parent, node.parent.parent], candidate => {
		if (candidate?.type !== 'CallExpression') return Option.none<ESTree.Node>()
		if (!Array.some(copiedArguments(context, candidate), argument => argument === node)) {
			return Option.none<ESTree.Node>()
		}
		return Option.some<ESTree.Node>(candidate)
	})
}

export const noAccumulatingCopy = defineRule({
	create: context => {
		const reported = MutableHashSet.empty<number>()
		return {
			CallExpression: node => {
				if (
					node.optional ||
					(node.arguments.length !== 2 && node.arguments.length !== 3) ||
					Array.some(node.arguments, argument => argument.type === 'SpreadElement') ||
					node.callee.type !== 'MemberExpression' ||
					node.callee.optional ||
					!Option.exists(memberName(node.callee), name => name === 'reduce' || name === 'reduceRight') ||
					!importedMember({context, importedName: 'Array', node: node.callee})
				) {
					return
				}
				const callback = node.arguments[node.arguments.length - 1]
				if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression') return
				const parameter = callback.params[0]
				if (parameter?.type !== 'Identifier') return
				pipe(
					variableFromScope({name: parameter.name, scope: context.sourceCode.getScope(callback)}),
					Option.map(variable => {
						for (const reference of variable.references) {
							pipe(
								copySite(context, reference.identifier),
								Option.filter(copy => !MutableHashSet.has(reported, copy.range[0])),
								Option.map(copy => {
									MutableHashSet.add(reported, copy.range[0])
									context.report({
										message:
											'Copying the accumulator in a fold can make collection building quadratic. Prefer Array.map/filterMap/flatMap/groupBy, Record.fromEntries, Array.mapAccum, or a local MutableList/MutableHashMap collector.',
										node: copy
									})
								})
							)
						}
					})
				)
			}
		}
	},
	meta: {type: 'problem'}
})
