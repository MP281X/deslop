import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {childNodes, importedMember, isImportBinding, memberName, returnedExpression} from '#rules/shared.ts'

// These APIs document rejected Promises; other adapters need their own failure contract established before joining this list.
function rejects(context: Context, node: ESTree.Node) {
	if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false
	const method = memberName(node.callee)
	if (node.callee.object.type === 'Identifier') {
		if (isImportBinding({context, node: node.callee.object, source: 'expo-secure-store'})) {
			return Option.contains(method, 'deleteItemAsync')
		}
		if (isImportBinding({context, node: node.callee.object, source: 'expo-notifications'})) {
			return Option.exists(method, name => Array.contains(['setBadgeCountAsync', 'requestPermissionsAsync'], name))
		}
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
			const callback = node.arguments[0]
			if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression') return
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
