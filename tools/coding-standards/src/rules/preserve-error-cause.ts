import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	childNodes,
	importedMember,
	memberName,
	resolveBinding,
	returnedExpression,
	variableFromScope
} from '#rules/shared.ts'

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

function referencesFailure(context: Context, node: ESTree.Node, parameter: ESTree.BindingIdentifier): boolean {
	if (node.type === 'UnaryExpression' && node.operator === 'void') return false
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'message')) return false
	if (node.type === 'Identifier') {
		return Option.exists(
			variableFromScope({name: parameter.name, scope: context.sourceCode.getScope(parameter)}),
			failure => Array.some(failure.references, reference => reference.identifier === node && reference.isRead())
		)
	}
	return Array.some(childNodes(context, node), child => referencesFailure(context, child, parameter))
}

function dropsCause(context: Context, argument: ESTree.Node, thrown = false) {
	const node = resolveBinding(context, argument)
	if (
		node.type !== 'ArrowFunctionExpression' &&
		node.type !== 'FunctionExpression' &&
		node.type !== 'FunctionDeclaration'
	) {
		return false
	}
	if (Array.isArrayEmpty(node.params)) return thrown
	const parameter = node.params[0]
	if (parameter?.type !== 'Identifier') return false
	return Option.exists(constructedFields(returnedExpression(node)), fields =>
		Array.every(
			fields.properties,
			property =>
				property.type === 'SpreadElement' ||
				!(
					(property.key.type === 'Identifier' && property.key.name === 'cause') ||
					(property.key.type === 'Literal' && property.key.value === 'cause')
				) ||
				!referencesFailure(context, property.value, parameter)
		)
	)
}

function report(context: Context, node: ESTree.Node) {
	context.report({message: 'Keep the original failure as the new error’s cause: X.make({cause, message}).', node})
}

// The failure mapper of an options object, such as `catch` of Effect.tryPromise or `onFailure` of Effect.mapBoth.
function reportOption(context: Context, key: string, thrown: boolean, options?: ESTree.Node) {
	if (options?.type !== 'ObjectExpression') return
	for (const property of options.properties) {
		if (
			property.type === 'Property' &&
			property.key.type === 'Identifier' &&
			property.key.name === key &&
			dropsCause(context, property.value, thrown)
		) {
			report(context, property.value)
		}
	}
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
				Array.forEach(
					Array.filter(node.arguments, argument => dropsCause(context, argument)),
					callback => report(context, callback)
				)
				return
			}
			if (Option.contains(name, 'mapBoth')) {
				Array.forEach(node.arguments, argument => reportOption(context, 'onFailure', false, argument))
				return
			}
			if (!Option.exists(name, method => method === 'try' || method === 'tryPromise')) return
			reportOption(context, 'catch', true, node.arguments[0])
		}
	}),
	meta: {type: 'problem'}
})
