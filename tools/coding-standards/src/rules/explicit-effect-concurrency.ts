import {Array, Boolean, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

// Options passed through a variable or spread are unknown here, so only a literal without concurrency is reported.
function statesConcurrency(node?: ESTree.Node) {
	if (node === undefined) return false
	if (node.type !== 'ObjectExpression') return true
	return Array.some(
		node.properties,
		property =>
			property.type === 'SpreadElement' ||
			(property.key.type === 'Identifier' && property.key.name === 'concurrency') ||
			(property.key.type === 'Literal' && property.key.value === 'concurrency')
	)
}

function isFunction(node?: ESTree.Node) {
	return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
}

export const explicitEffectConcurrency = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			const name = memberName(node.callee)
			if (!Option.exists(name, method => method === 'all' || method === 'forEach')) return
			// Effect.all(effects, options), Effect.forEach(items, f, options), or a data-last forEach(f, options) with an inline f or literal options.
			const index = Boolean.match(
				Option.contains(name, 'all') || isFunction(node.arguments[0]) || node.arguments[1]?.type === 'ObjectExpression',
				{onFalse: () => 2, onTrue: () => 1}
			)
			if (statesConcurrency(node.arguments[index])) return
			context.report({
				message:
					"Choose the concurrency: {concurrency: 'unbounded'} for independent effects, {concurrency: 1} when order or a shared resource matters.",
				node: node.callee
			})
		}
	}),
	meta: {type: 'problem'}
})
