import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName, returnedExpression} from '#rules/shared.ts'

// The fields of `X.make({...})` or `new X({...})`, the shapes a mapped error is built with.
function constructedFields(node?: ESTree.Expression | null) {
	if (node?.type !== 'CallExpression' && node?.type !== 'NewExpression') return Option.none()
	const constructs =
		node.type === 'NewExpression' ||
		(node.callee.type === 'MemberExpression' && Option.contains(memberName(node.callee), 'make'))
	const fields = node.arguments[0]
	if (!constructs || fields?.type !== 'ObjectExpression') return Option.none()
	return Option.some(fields)
}

function dropsCause(node: ESTree.Node) {
	if (
		(node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') ||
		Array.isArrayEmpty(node.params)
	) {
		return false
	}
	return Option.exists(constructedFields(returnedExpression(node)), fields =>
		Array.every(
			fields.properties,
			property =>
				property.type === 'SpreadElement' || !(property.key.type === 'Identifier' && property.key.name === 'cause')
		)
	)
}

function report(context: Context, node: ESTree.Node) {
	context.report({message: 'Keep the original failure as the new error’s cause: X.make({cause, message}).', node})
}

export const preserveErrorCause = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			const name = memberName(node.callee)
			if (Option.contains(name, 'mapError')) {
				Array.forEach(Array.filter(node.arguments, dropsCause), callback => report(context, callback))
				return
			}
			if (!Option.exists(name, method => method === 'try' || method === 'tryPromise')) return
			const options = node.arguments[0]
			if (options?.type !== 'ObjectExpression') return
			for (const property of options.properties) {
				if (
					property.type === 'Property' &&
					property.key.type === 'Identifier' &&
					property.key.name === 'catch' &&
					dropsCause(property.value)
				) {
					report(context, property.value)
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
