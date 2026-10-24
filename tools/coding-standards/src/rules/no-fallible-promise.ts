import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	childNodes,
	importedMember,
	isImportBinding,
	memberName,
	resolveBinding,
	returnedExpression
} from '#rules/shared.ts'

// These APIs document rejected Promises; other adapters need their own failure contract established before joining this list.
const REJECTING_APIS = [
	{methods: ['deleteItemAsync'], source: 'expo-secure-store'},
	{methods: ['setBadgeCountAsync', 'requestPermissionsAsync', 'getExpoPushTokenAsync'], source: 'expo-notifications'}
]

function rejects(context: Context, node: ESTree.Node) {
	if (node.type !== 'CallExpression') return false
	if (node.callee.type === 'Identifier') {
		return Array.some(REJECTING_APIS, api =>
			Array.some(
				api.methods,
				importedName =>
					node.callee.type === 'Identifier' &&
					isImportBinding({context, importedName, node: node.callee, source: api.source})
			)
		)
	}
	if (node.callee.type !== 'MemberExpression') return false
	const method = memberName(node.callee)
	if (node.callee.object.type === 'Identifier') {
		return Array.some(
			REJECTING_APIS,
			api =>
				node.callee.type === 'MemberExpression' &&
				node.callee.object.type === 'Identifier' &&
				isImportBinding({context, node: node.callee.object, source: api.source}) &&
				Option.exists(method, name => Array.contains(api.methods, name))
		)
	}
	return (
		Option.contains(method, 'downloadAsync') &&
		node.callee.object.type === 'CallExpression' &&
		node.callee.object.callee.type === 'MemberExpression' &&
		Option.contains(memberName(node.callee.object.callee), 'fromModule') &&
		node.callee.object.callee.object.type === 'Identifier' &&
		isImportBinding({context, importedName: 'Asset', node: node.callee.object.callee.object, source: 'expo-asset'})
	)
}

function containsRejection(context: Context, node: ESTree.Node): boolean {
	if (rejects(context, node)) return true
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return false
	return Array.some(childNodes(node), child => containsRejection(context, child))
}

export const noFalliblePromise = defineRule({
	create: context => ({
		CallExpression: node => {
			if (!importedMember({context, importedName: 'Effect', node: node.callee, propertyName: 'promise'})) return
			const argument = node.arguments[0]
			if (argument === undefined) return
			const callback = resolveBinding(context, argument)
			if (
				callback.type !== 'ArrowFunctionExpression' &&
				callback.type !== 'FunctionExpression' &&
				callback.type !== 'FunctionDeclaration'
			) {
				return
			}
			const returned = returnedExpression(callback)
			if (Predicate.isNullish(returned) || !containsRejection(context, returned)) return
			context.report({
				message:
					'This API can reject. Use Effect.tryPromise so expected I/O failures reach typed recovery, not the defect channel.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
