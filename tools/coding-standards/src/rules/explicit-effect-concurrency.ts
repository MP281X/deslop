import {Array, Boolean, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, memberName, variableFromScope} from '#rules/shared.ts'

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

function isFunction(context: Context, node?: ESTree.Node) {
	if (node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression') return true
	if (node?.type !== 'Identifier') return false
	return Option.exists(variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}), variable =>
		Array.some(variable.defs, definition => {
			if (definition.node.type === 'FunctionDeclaration') return true
			if (definition.node.type !== 'VariableDeclarator') return false
			if (
				definition.node.init?.type === 'ArrowFunctionExpression' ||
				definition.node.init?.type === 'FunctionExpression'
			) {
				return true
			}
			if (definition.node.init?.type !== 'CallExpression') return false
			if (
				importedMember({
					context,
					importedName: 'Effect',
					node: definition.node.init.callee,
					propertyName: 'fnUntraced'
				}) ||
				importedMember({context, importedName: 'Effect', node: definition.node.init.callee, propertyName: 'fn'})
			) {
				return true
			}
			return (
				definition.node.init.callee.type === 'CallExpression' &&
				importedMember({context, importedName: 'Effect', node: definition.node.init.callee.callee, propertyName: 'fn'})
			)
		})
	)
}

export const explicitEffectConcurrency = defineRule({
	create: context => ({
		CallExpression: node => {
			if (node.callee.type !== 'MemberExpression') return
			const name = memberName(node.callee)
			if (
				!Option.exists(name, method => method === 'all' || method === 'forEach') ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			// Effect.all(effects, options), Effect.forEach(items, f, options), or a data-last forEach(f, options) with an inline f or literal options.
			const index = Boolean.match(
				Option.contains(name, 'all') ||
					isFunction(context, node.arguments[0]) ||
					node.arguments[1]?.type === 'ObjectExpression',
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
