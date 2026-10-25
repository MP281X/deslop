import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {childNodes, importedMember, memberName} from '#rules/shared.ts'

function isMessage(node: ESTree.Node, name: string) {
	return (
		node.type === 'MemberExpression' &&
		Option.contains(memberName(node), 'message') &&
		node.object.type === 'Identifier' &&
		node.object.name === name
	)
}

function inspect(context: Context, node: ESTree.Node, name: string): void {
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionExpression' ||
		node.type === 'FunctionDeclaration'
	) {
		return
	}
	if (
		node.type === 'BinaryExpression' &&
		Array.contains(['===', '!==', '==', '!='], node.operator) &&
		(isMessage(node.left, name) || isMessage(node.right, name))
	) {
		context.report({
			message:
				'Choose retry or recovery by a typed reason or tag; message wording is presentation, not a machine discriminant.',
			node
		})
	}
	Array.forEach(childNodes(context, node), child => inspect(context, child, name))
}

function inspectPredicate(context: Context, node?: ESTree.Node) {
	if (node?.type !== 'ArrowFunctionExpression' && node?.type !== 'FunctionExpression') return
	const parameter = node.params[0]
	if (parameter?.type !== 'Identifier' || node.body === null) return
	inspect(context, node.body, parameter.name)
}

export const noErrorMessageControlFlow = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			if (Option.contains(memberName(node.callee), 'catchIf')) {
				if (node.arguments.length === 3) inspectPredicate(context, node.arguments[1])
				if (node.arguments.length === 2) inspectPredicate(context, node.arguments[0])
				return
			}
			if (!Option.contains(memberName(node.callee), 'retry')) return
			for (const property of Array.flatMap(node.arguments, argument => {
				if (argument.type === 'ObjectExpression') return argument.properties
				return []
			})) {
				if (
					property.type === 'Property' &&
					property.key.type === 'Identifier' &&
					Array.contains(['while', 'until'], property.key.name)
				) {
					inspectPredicate(context, property.value)
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
